//! The local MCP bridge for the desktop app.
//!
//! Agents never talk to a port. They launch `Precipice --mcp`, which is this same binary in a
//! headless pipe mode: it connects to the running app over a Unix socket that only this macOS
//! user can open, starting the app in the background first if it is not running. Inside the
//! app, each socket line is handed to the webview, where the MCP server and the document
//! command service live. The native side never parses MCP and never touches documents.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

const BUNDLE_ID: &str = "dev.precipice.desktop";
/// One JSON-RPC message per line; anything longer is not a message this app would send.
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

pub fn socket_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into());
    home.join("Library/Application Support")
        .join(BUNDLE_ID)
        .join("mcp.sock")
}

// ---------------------------------------------------------------------------------------------
// Pipe mode: `Precipice --mcp`
// ---------------------------------------------------------------------------------------------

fn app_bundle() -> Option<PathBuf> {
    // …/Precipice.app/Contents/MacOS/<binary>
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?.to_path_buf();
    (bundle.extension().and_then(|e| e.to_str()) == Some("app")).then_some(bundle)
}

fn launch_app() {
    let mut command = std::process::Command::new("/usr/bin/open");
    command.arg("-g");
    match app_bundle() {
        Some(bundle) => command.arg(bundle),
        None => command.args(["-b", BUNDLE_ID]),
    };
    let _ = command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

fn connect_or_launch() -> Option<UnixStream> {
    let path = socket_path();
    if let Ok(stream) = UnixStream::connect(&path) {
        return Some(stream);
    }
    launch_app();
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
        if let Ok(stream) = UnixStream::connect(&path) {
            return Some(stream);
        }
    }
    None
}

/// Remembers the agent's MCP handshake so a restarted app can be brought up to date without the
/// agent noticing. Agents such as Claude Desktop never restart a server that went away, so the
/// pipe outlives the app instead: replayed requests carry private ids and their replies are
/// dropped.
#[derive(Default)]
struct Handshake {
    initialize: Option<serde_json::Value>,
    initialized: Option<String>,
    replays: u64,
}

fn method_of(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    value.get("method")?.as_str().map(str::to_owned)
}

impl Handshake {
    fn observe(&mut self, line: &str) {
        match method_of(line).as_deref() {
            Some("initialize") => self.initialize = serde_json::from_str(line).ok(),
            Some("notifications/initialized") => self.initialized = Some(line.to_owned()),
            _ => {}
        }
    }

    /// Lines to send first on a fresh connection, and the private id whose reply to drop.
    fn replay(&mut self) -> Option<(Vec<String>, String)> {
        let mut initialize = self.initialize.clone()?;
        self.replays += 1;
        let id = format!("precipice-replay-{}", self.replays);
        initialize["id"] = serde_json::Value::String(id.clone());
        let mut lines = vec![initialize.to_string()];
        lines.extend(self.initialized.clone());
        Some((lines, id))
    }
}

fn is_reply_to(line: &str, id: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line)
        .map(|value| value.get("method").is_none() && value.get("id").and_then(|v| v.as_str()) == Some(id))
        .unwrap_or(false)
}

struct Upstream {
    stream: UnixStream,
    alive: std::sync::Arc<AtomicBool>,
}

/// Connects (launching the app if needed) and forwards the app's lines to stdout.
fn open_upstream(drop_reply: Option<String>) -> Option<Upstream> {
    let stream = connect_or_launch()?;
    let reader = stream.try_clone().ok()?;
    let alive = std::sync::Arc::new(AtomicBool::new(true));
    let flag = alive.clone();
    std::thread::spawn(move || {
        let mut drop_reply = drop_reply;
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            if drop_reply.as_deref().is_some_and(|id| is_reply_to(&line, id)) {
                drop_reply = None;
                continue;
            }
            let mut stdout = std::io::stdout().lock();
            if writeln!(stdout, "{line}").and_then(|_| stdout.flush()).is_err() {
                std::process::exit(0);
            }
        }
        flag.store(false, Ordering::SeqCst);
    });
    Some(Upstream { stream, alive })
}

/// Runs the stdio ⇄ socket pipe until the agent closes stdin. Never starts the GUI itself; if
/// the app quits, the next message relaunches it in the background and replays the handshake.
pub fn run_pipe() -> i32 {
    let mut handshake = Handshake::default();
    let mut upstream: Option<Upstream> = None;
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let handshaking = matches!(
            method_of(&line).as_deref(),
            Some("initialize") | Some("notifications/initialized")
        );
        let mut delivered = false;
        for _ in 0..2 {
            if upstream.as_ref().map_or(true, |u| !u.alive.load(Ordering::SeqCst)) {
                let replay = if handshaking { None } else { handshake.replay() };
                let Some(mut next) = open_upstream(replay.as_ref().map(|(_, id)| id.clone())) else {
                    eprintln!("Precipice did not start. Open Precipice once, then retry.");
                    return 1;
                };
                for earlier in replay.map(|(lines, _)| lines).unwrap_or_default() {
                    let _ = writeln!(next.stream, "{earlier}");
                }
                upstream = Some(next);
            }
            let current = upstream.as_mut().expect("connected above");
            if writeln!(current.stream, "{line}").is_ok() {
                delivered = true;
                break;
            }
            current.alive.store(false, Ordering::SeqCst);
        }
        if !delivered {
            eprintln!("Lost the connection to Precipice.");
            return 1;
        }
        handshake.observe(&line);
    }
    if let Some(current) = upstream {
        let _ = current.stream.shutdown(std::net::Shutdown::Both);
    }
    0
}

// ---------------------------------------------------------------------------------------------
// App mode: the socket listener
// ---------------------------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
struct MessageEvent {
    conn: u64,
    line: String,
}

#[derive(Clone, serde::Serialize)]
struct ClosedEvent {
    conn: u64,
}

struct Bridge {
    app: AppHandle,
    writers: Mutex<HashMap<u64, UnixStream>>,
    ready: AtomicBool,
    /// Lines that arrived before the webview subscribed. Flushed by `mcp_ready`.
    backlog: Mutex<Vec<MessageEvent>>,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();
static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

impl Bridge {
    fn deliver(&self, event: MessageEvent) {
        if self.ready.load(Ordering::SeqCst) {
            let _ = self.app.emit("mcp://message", event);
        } else if let Ok(mut backlog) = self.backlog.lock() {
            backlog.push(event);
        }
    }
}

fn serve(stream: UnixStream) {
    let Some(bridge) = BRIDGE.get() else { return };
    let conn = NEXT_CONN.fetch_add(1, Ordering::SeqCst);
    let Ok(writer) = stream.try_clone() else { return };
    if let Ok(mut writers) = bridge.writers.lock() {
        writers.insert(conn, writer);
    }
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        line.clear();
        match (&mut reader).take(MAX_LINE_BYTES as u64).read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let text = line.trim_end_matches(['\r', '\n']);
                if !text.is_empty() {
                    bridge.deliver(MessageEvent { conn, line: text.to_string() });
                }
            }
        }
    }
    if let Ok(mut writers) = bridge.writers.lock() {
        writers.remove(&conn);
    }
    let _ = bridge.app.emit("mcp://closed", ClosedEvent { conn });
}

pub fn start_listener(app: AppHandle) {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    // A live socket means another copy of the app is already serving; leave it alone.
    if UnixStream::connect(&path).is_ok() {
        return;
    }
    let _ = std::fs::remove_file(&path);
    let Ok(listener) = UnixListener::bind(&path) else { return };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    let _ = BRIDGE.set(Bridge {
        app,
        writers: Mutex::new(HashMap::new()),
        ready: AtomicBool::new(false),
        backlog: Mutex::new(Vec::new()),
    });
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || serve(stream));
        }
    });
}

#[tauri::command]
pub fn mcp_ready() {
    let Some(bridge) = BRIDGE.get() else { return };
    bridge.ready.store(true, Ordering::SeqCst);
    let backlog = bridge
        .backlog
        .lock()
        .map(|mut b| std::mem::take(&mut *b))
        .unwrap_or_default();
    for event in backlog {
        let _ = bridge.app.emit("mcp://message", event);
    }
}

#[tauri::command]
pub fn mcp_send(conn: u64, line: String) -> Result<(), &'static str> {
    if line.contains('\n') || line.len() > MAX_LINE_BYTES {
        return Err("Invalid message");
    }
    let bridge = BRIDGE.get().ok_or("Bridge unavailable")?;
    let mut writers = bridge.writers.lock().map_err(|_| "Bridge unavailable")?;
    let writer = writers.get_mut(&conn).ok_or("Connection closed")?;
    writer
        .write_all(format!("{line}\n").as_bytes())
        .map_err(|_| "Connection closed")
}

// ---------------------------------------------------------------------------------------------
// One-click client setup
// ---------------------------------------------------------------------------------------------

fn helper_command() -> Result<String, &'static str> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| "Could not locate Precipice")
}

#[tauri::command]
pub fn mcp_helper_path() -> Result<String, &'static str> {
    helper_command()
}

fn home() -> Result<PathBuf, &'static str> {
    std::env::var_os("HOME").map(PathBuf::from).ok_or("No home directory")
}

/// Adds (or refreshes) only the `precipice` entry; every other server in the file is kept.
fn merge_json_config(path: PathBuf, command: &str) -> Result<(), &'static str> {
    let mut root: serde_json::Value = match read_config(&path)? {
        text if !text.trim().is_empty() => {
            serde_json::from_str(&text).map_err(|_| "The existing config file is not valid JSON")?
        }
        _ => serde_json::json!({}),
    };
    let object = root.as_object_mut().ok_or("The existing config file is not a JSON object")?;
    let servers = object
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("mcpServers is not an object")?;
    servers.insert(
        "precipice".into(),
        serde_json::json!({ "command": command, "args": ["--mcp"] }),
    );
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "Could not create the config folder")?;
    }
    let text = serde_json::to_string_pretty(&root).map_err(|_| "Could not write config")?;
    write_config(&path, &(text + "\n"))
}

fn read_config(path: &PathBuf) -> Result<String, &'static str> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err("Could not read the existing config file"),
    }
}

fn write_config(path: &PathBuf, text: &str) -> Result<(), &'static str> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "Could not create config folder")?;
    }
    let temporary = path.with_extension(format!("precipice-{}.tmp", std::process::id()));
    std::fs::write(&temporary, text).map_err(|_| "Could not write config")?;
    std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600)).map_err(|_| "Could not protect config")?;
    std::fs::rename(temporary, path).map_err(|_| "Could not replace config")
}

fn merge_codex_config(path: PathBuf, command: &str) -> Result<(), &'static str> {
    let existing = read_config(&path)?;
    let mut document = existing.parse::<toml_edit::DocumentMut>().map_err(|_| "The existing config is not valid TOML")?;
    let mut server = toml_edit::Table::new();
    server["command"] = toml_edit::value(command);
    let mut args = toml_edit::Array::new();
    args.push("--mcp");
    server["args"] = toml_edit::value(args);
    if document.get("mcp_servers").is_none() { document["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new()); }
    let servers = document["mcp_servers"].as_table_mut().ok_or("mcp_servers is not a table")?;
    servers.insert("precipice", toml_edit::Item::Table(server));
    write_config(&path, &document.to_string())
}

#[tauri::command]
pub fn mcp_install_client(client: String) -> Result<String, &'static str> {
    let command = helper_command()?;
    let home = home()?;
    match client.as_str() {
        "claude-desktop" => {
            merge_json_config(
                home.join("Library/Application Support/Claude/claude_desktop_config.json"),
                &command,
            )?;
            Ok("Added to Claude Desktop. Restart Claude to finish.".into())
        }
        "cursor" => {
            merge_json_config(home.join(".cursor/mcp.json"), &command)?;
            Ok("Added to Cursor.".into())
        }
        "codex" => {
            merge_codex_config(home.join(".codex/config.toml"), &command)?;
            Ok("Added to Codex. Start a new Codex session to use it.".into())
        }
        _ => Err("Unknown client"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("precipice-mcp-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn handshake_replays_with_a_private_id_once_initialized() {
        let mut handshake = Handshake::default();
        assert!(handshake.replay().is_none());
        handshake.observe(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"clientInfo":{"name":"claude-ai"}}}"#);
        handshake.observe(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        handshake.observe(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
        let (lines, id) = handshake.replay().unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("claude-ai") && lines[0].contains(&id));
        assert!(lines[1].contains("notifications/initialized"));
        assert!(is_reply_to(&format!(r#"{{"jsonrpc":"2.0","id":"{id}","result":{{}}}}"#), &id));
        assert!(!is_reply_to(r#"{"jsonrpc":"2.0","id":0,"result":{}}"#, &id));
        assert_ne!(handshake.replay().unwrap().1, id);
    }

    #[test]
    fn json_merge_keeps_other_servers() {
        let path = temp("json").join("config.json");
        std::fs::write(&path, r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#).unwrap();
        merge_json_config(path.clone(), "/Applications/Precipice.app/Contents/MacOS/p").unwrap();
        merge_json_config(path.clone(), "/Applications/Precipice.app/Contents/MacOS/p").unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "x");
        assert_eq!(value["mcpServers"]["precipice"]["args"][0], "--mcp");
    }

    #[test]
    fn json_merge_refuses_to_overwrite_invalid_files() {
        let path = temp("invalid").join("config.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(merge_json_config(path.clone(), "p").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn codex_merge_replaces_only_its_own_table() {
        let path = temp("toml").join("config.toml");
        std::fs::write(
            &path,
            "model = \"o5\"\n\n[mcp_servers.precipice]\ncommand = \"old\"\n\n[mcp_servers.other]\ncommand = \"y\"\n",
        )
        .unwrap();
        merge_codex_config(path.clone(), "/new \"path\"").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("model = \"o5\""));
        assert!(text.contains("[mcp_servers.other]\ncommand = \"y\""));
        assert!(!text.contains("\"old\""));
        assert_eq!(text.matches("[mcp_servers.precipice]").count(), 1);
        assert_eq!(text.parse::<toml_edit::DocumentMut>().unwrap()["mcp_servers"]["precipice"]["command"].as_str(), Some("/new \"path\""));
    }
}
