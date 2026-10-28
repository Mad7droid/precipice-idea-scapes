//! The local MCP bridge for the desktop app.
//!
//! Agents never talk to a port. They launch `Precipice --mcp`, which is this same binary in a
//! headless pipe mode: it connects to the running app over a Unix socket that only this macOS
//! user can open. Discovery works while the app is closed; library calls ask the user to
//! open it manually. This helper never launches or focuses the GUI. Inside the
//! app, each socket line is handed to the webview, where the MCP server and the document
//! command service live. The native side handles offline discovery, never documents.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// The bundle identifier from tauri.conf.json (see build.rs), so differently identified builds
/// (dev, beta) never share or hijack one another's socket.
pub const BUNDLE_ID: &str = env!("PRECIPICE_IDENTIFIER");
/// Environment variable carrying the per-install token written by `mcp_install_client`.
const TOKEN_ENV: &str = "PRECIPICE_MCP_TOKEN";
/// Write timeout so a stalled agent can never wedge the webview's send path.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// One JSON-RPC message per line; anything longer is not a message this app would send.
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

fn support_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| "/tmp".into());
    home.join("Library/Application Support").join(BUNDLE_ID)
}

pub fn socket_path() -> PathBuf {
    support_dir().join("mcp.sock")
}

/// Install tokens, keyed by token, valued by the client the token was written for. The agent
/// never picks this value; it can only present the token from its own config.
fn installs_path() -> PathBuf {
    support_dir().join("mcp-installs.json")
}

fn read_installs() -> serde_json::Map<String, serde_json::Value> {
    std::fs::read_to_string(installs_path())
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

/// The verified install for a presented token, if any.
fn install_for(token: &str) -> Option<String> {
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    read_installs().get(token)?.as_str().map(str::to_owned)
}

/// Mints a new token for `client`, replacing that client's previous token.
fn mint_install_token(client: &str) -> Result<String, &'static str> {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut installs = read_installs();
    installs.retain(|_, value| value.as_str() != Some(client));
    installs.insert(token.clone(), client.into());
    let text = serde_json::to_string(&installs).map_err(|_| "Could not save install")?;
    write_config(&installs_path(), &text)?;
    Ok(token)
}

/// First line a helper sends on every connection. Never forwarded to the webview.
fn hello_line(token: Option<&str>) -> String {
    serde_json::json!({ "precipice_hello": { "token": token } }).to_string()
}

fn parse_hello(line: &str) -> Option<Option<String>> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let hello = value.get("precipice_hello")?;
    Some(
        hello
            .get("token")
            .and_then(|t| t.as_str())
            .map(str::to_owned),
    )
}

// ---------------------------------------------------------------------------------------------
// Pipe mode: `Precipice --mcp`
// ---------------------------------------------------------------------------------------------

/// Static discovery is generated from the shared MCP server at build time. It contains
/// schemas and descriptions only, never documents or credentials.
fn offline_reply(line: &str) -> Option<serde_json::Value> {
    let request: serde_json::Value = serde_json::from_str(line).ok()?;
    let id = request.get("id")?;
    let method = request.get("method")?.as_str()?;
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("mcp-discovery.json")).ok()?;
    let result = match method {
        "initialize" => {
            let mut result = manifest["initialize"].clone();
            if let Some(version) = request
                .pointer("/params/protocolVersion")
                .and_then(|v| v.as_str())
            {
                if manifest["protocols"]
                    .as_array()?
                    .iter()
                    .any(|v| v.as_str() == Some(version))
                {
                    result["protocolVersion"] = version.into();
                }
            }
            result
        }
        "ping" => serde_json::json!({}),
        "tools/list" | "prompts/list" | "resources/list" | "resources/templates/list" => {
            manifest[method].clone()
        }
        "tools/call" => serde_json::json!({
            "isError": true,
            "content": [{ "type": "text", "text": "Precipice is closed or unavailable. Open Precipice on this Mac, then retry this tool. No changes were made." }]
        }),
        _ => {
            return Some(serde_json::json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": -32000, "message": "Open Precipice on this Mac, then retry this request." }
            }))
        }
    };
    Some(serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn write_offline_reply(line: &str) -> std::io::Result<()> {
    if let Some(reply) = offline_reply(line) {
        let mut stdout = std::io::stdout().lock();
        writeln!(stdout, "{reply}")?;
        stdout.flush()?;
    }
    Ok(())
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
        .map(|value| {
            value.get("method").is_none() && value.get("id").and_then(|v| v.as_str()) == Some(id)
        })
        .unwrap_or(false)
}

struct Upstream {
    stream: UnixStream,
    alive: std::sync::Arc<AtomicBool>,
}

/// Connects only to an already-running app and forwards its lines to stdout.
fn open_upstream(drop_reply: Option<String>) -> Option<Upstream> {
    let mut stream = UnixStream::connect(socket_path()).ok()?;
    let token = std::env::var(TOKEN_ENV).ok();
    writeln!(stream, "{}", hello_line(token.as_deref())).ok()?;
    let reader = stream.try_clone().ok()?;
    let alive = std::sync::Arc::new(AtomicBool::new(true));
    let flag = alive.clone();
    std::thread::spawn(move || {
        let mut drop_reply = drop_reply;
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            if drop_reply
                .as_deref()
                .is_some_and(|id| is_reply_to(&line, id))
            {
                drop_reply = None;
                continue;
            }
            let mut stdout = std::io::stdout().lock();
            if writeln!(stdout, "{line}")
                .and_then(|_| stdout.flush())
                .is_err()
            {
                std::process::exit(0);
            }
        }
        flag.store(false, Ordering::SeqCst);
    });
    Some(Upstream { stream, alive })
}

/// Runs until the agent closes stdin. While the GUI is closed, discovery is answered
/// locally. After the user opens it, the next request reconnects and replays the handshake.
pub fn run_pipe() -> i32 {
    let mut handshake = Handshake::default();
    let mut upstream: Option<Upstream> = None;
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let initializing = method_of(&line).as_deref() == Some("initialize");
        let mut delivered = false;
        for _ in 0..2 {
            if upstream
                .as_ref()
                .is_none_or(|u| !u.alive.load(Ordering::SeqCst))
            {
                let replay = if initializing {
                    None
                } else {
                    handshake.replay()
                };
                let Some(mut next) = open_upstream(replay.as_ref().map(|(_, id)| id.clone()))
                else {
                    break;
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
            upstream = None;
            if write_offline_reply(&line).is_err() {
                return 0;
            }
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
    /// The client a verified install token was written for; `None` for unverified helpers.
    install: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct ClosedEvent {
    conn: u64,
}

struct Bridge {
    app: AppHandle,
    /// Per-connection writers, so one slow agent never blocks sends to the others.
    writers: Mutex<HashMap<u64, Arc<Mutex<UnixStream>>>>,
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

/// Reads one line of at most `MAX_LINE_BYTES`. `Err` means the peer must be dropped: a longer
/// line is never split into fragments that could parse as separate messages.
fn read_bounded_line(reader: &mut impl BufRead, line: &mut String) -> Result<usize, ()> {
    line.clear();
    let read = reader
        .take(MAX_LINE_BYTES as u64 + 1)
        .read_line(line)
        .map_err(|_| ())?;
    if read > 0 && !line.ends_with('\n') && line.len() > MAX_LINE_BYTES {
        return Err(());
    }
    Ok(read)
}

fn serve(stream: UnixStream) {
    let Some(bridge) = BRIDGE.get() else { return };
    let conn = NEXT_CONN.fetch_add(1, Ordering::SeqCst);
    let Ok(writer) = stream.try_clone() else {
        return;
    };
    let _ = writer.set_write_timeout(Some(WRITE_TIMEOUT));
    if let Ok(mut writers) = bridge.writers.lock() {
        writers.insert(conn, Arc::new(Mutex::new(writer)));
    }
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let mut install: Option<String> = None;
    let mut first = true;
    while let Ok(read) = read_bounded_line(&mut reader, &mut line) {
        if read == 0 {
            break;
        }
        let text = line.trim_end_matches(['\r', '\n']);
        if first {
            first = false;
            if let Some(token) = parse_hello(text) {
                install = token.as_deref().and_then(install_for);
                continue;
            }
        }
        if !text.is_empty() {
            bridge.deliver(MessageEvent {
                conn,
                line: text.to_string(),
                install: install.clone(),
            });
        }
    }
    if let Some(writer) = bridge.writers.lock().ok().and_then(|mut w| w.remove(&conn)) {
        if let Ok(writer) = writer.lock() {
            let _ = writer.shutdown(std::net::Shutdown::Both);
        }
    }
    let _ = bridge.app.emit("mcp://closed", ClosedEvent { conn });
}

pub fn start_listener(app: AppHandle) {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    // A live socket means another copy of the app is already serving; leave it alone and let
    // the UI say so via `mcp_status`.
    if UnixStream::connect(&path).is_ok() {
        set_listener_state(ListenerState::OtherCopy);
        return;
    }
    let _ = std::fs::remove_file(&path);
    // The parent folder is 0700, so the socket is private from the moment it is bound; the
    // chmod below narrows the node itself too.
    let Ok(listener) = UnixListener::bind(&path) else {
        set_listener_state(ListenerState::Failed);
        return;
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    set_listener_state(ListenerState::Listening);
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

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ListenerState {
    Starting,
    Listening,
    /// Another copy of Precipice (same identifier) owns the socket; agents reach that copy.
    OtherCopy,
    Failed,
}

static LISTENER_STATE: Mutex<ListenerState> = Mutex::new(ListenerState::Starting);

fn set_listener_state(state: ListenerState) {
    if let Ok(mut current) = LISTENER_STATE.lock() {
        *current = state;
    }
}

#[derive(serde::Serialize)]
pub struct McpStatus {
    listener: ListenerState,
    identifier: &'static str,
}

#[tauri::command]
pub fn mcp_status() -> McpStatus {
    McpStatus {
        listener: LISTENER_STATE
            .lock()
            .map(|s| *s)
            .unwrap_or(ListenerState::Failed),
        identifier: BUNDLE_ID,
    }
}

#[tauri::command(async)]
pub fn mcp_send(conn: u64, line: String) -> Result<(), &'static str> {
    if line.contains('\n') || line.len() > MAX_LINE_BYTES {
        return Err("Invalid message");
    }
    let bridge = BRIDGE.get().ok_or("Bridge unavailable")?;
    // Hold the map lock only long enough to clone this connection's handle.
    let writer = bridge
        .writers
        .lock()
        .map_err(|_| "Bridge unavailable")?
        .get(&conn)
        .cloned()
        .ok_or("Connection closed")?;
    let mut stream = writer.lock().map_err(|_| "Connection closed")?;
    let mut bytes = line.into_bytes();
    bytes.push(b'\n');
    if stream.write_all(&bytes).is_err() {
        // A timed-out or broken peer may have a partial line; drop it rather than desync.
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return Err("Connection closed");
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// One-click client setup
// ---------------------------------------------------------------------------------------------

/// Locations an agent config must never point at: a mounted disk image, a Gatekeeper
/// translocation copy, or a cargo build tree. All of them disappear or move.
fn unstable_location(path: &std::path::Path) -> bool {
    let text = path.to_string_lossy();
    text.starts_with("/Volumes/")
        || text.contains("/AppTranslocation/")
        || path.components().any(|c| c.as_os_str() == "target")
}

fn helper_command() -> Result<String, &'static str> {
    let exe = std::env::current_exe().map_err(|_| "Could not locate Precipice")?;
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
    if unstable_location(&exe) {
        return Err("Move Precipice to your Applications folder and open it from there, then set up the agent again.");
    }
    Ok(exe.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn mcp_helper_path() -> Result<String, &'static str> {
    helper_command()
}

fn home() -> Result<PathBuf, &'static str> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("No home directory")
}

/// Adds (or refreshes) only the `precipice` entry; every other server in the file is kept.
fn merge_json_config(path: PathBuf, command: &str, token: &str) -> Result<(), &'static str> {
    let mut root: serde_json::Value = match read_config(&path)? {
        text if !text.trim().is_empty() => {
            serde_json::from_str(&text).map_err(|_| "The existing config file is not valid JSON")?
        }
        _ => serde_json::json!({}),
    };
    let object = root
        .as_object_mut()
        .ok_or("The existing config file is not a JSON object")?;
    let servers = object
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("mcpServers is not an object")?;
    servers.insert(
        "precipice".into(),
        serde_json::json!({ "command": command, "args": ["--mcp"], "env": { TOKEN_ENV: token } }),
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
    // Dotfile managers often symlink these configs; replace the link's target, keep the link.
    let resolved = std::fs::canonicalize(path).ok();
    let path = resolved.as_ref().unwrap_or(path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "Could not create config folder")?;
    }
    let temporary = path.with_extension(format!("precipice-{}.tmp", std::process::id()));
    std::fs::write(&temporary, text).map_err(|_| "Could not write config")?;
    std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| "Could not protect config")?;
    std::fs::rename(temporary, path).map_err(|_| "Could not replace config")
}

fn merge_codex_config(path: PathBuf, command: &str, token: &str) -> Result<(), &'static str> {
    let existing = read_config(&path)?;
    let mut document = existing
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "The existing config is not valid TOML")?;
    let mut server = toml_edit::Table::new();
    server["command"] = toml_edit::value(command);
    let mut args = toml_edit::Array::new();
    args.push("--mcp");
    server["args"] = toml_edit::value(args);
    let mut env = toml_edit::InlineTable::new();
    env.insert(TOKEN_ENV, token.into());
    server["env"] = toml_edit::value(env);
    if document.get("mcp_servers").is_none() {
        document["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    let servers = document["mcp_servers"]
        .as_table_mut()
        .ok_or("mcp_servers is not a table")?;
    servers.insert("precipice", toml_edit::Item::Table(server));
    write_config(&path, &document.to_string())
}

#[tauri::command]
pub fn mcp_install_client(client: String) -> Result<String, &'static str> {
    if !matches!(client.as_str(), "claude-desktop" | "cursor" | "codex") {
        return Err("Unknown client");
    }
    let command = helper_command()?;
    let home = home()?;
    let token = mint_install_token(&client)?;
    let token = token.as_str();
    match client.as_str() {
        "claude-desktop" => {
            merge_json_config(
                home.join("Library/Application Support/Claude/claude_desktop_config.json"),
                &command,
                token,
            )?;
            Ok("Added to Claude Desktop. Restart Claude to finish.".into())
        }
        "cursor" => {
            merge_json_config(home.join(".cursor/mcp.json"), &command, token)?;
            Ok("Added to Cursor.".into())
        }
        "codex" => {
            merge_codex_config(home.join(".codex/config.toml"), &command, token)?;
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
    fn offline_startup_answers_discovery_without_opening_the_app() {
        let init = offline_reply(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#).unwrap();
        assert_eq!(init["id"], 0);
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "precipice");
        let tools = offline_reply(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).unwrap();
        assert!(tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["name"] == "get_scape"));
        assert!(
            offline_reply(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none()
        );
        assert!(offline_reply("invalid json").is_none());
    }

    #[test]
    fn offline_library_calls_explain_how_to_reconnect_without_exiting() {
        for id in [serde_json::json!(2), serde_json::json!("call-3")] {
            let request = serde_json::json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"get_scape","arguments":{}}});
            let reply = offline_reply(&request.to_string()).unwrap();
            assert_eq!(reply["id"], id);
            assert_eq!(reply["result"]["isError"], true);
            assert!(reply["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Open Precipice"));
        }
        let ping = offline_reply(r#"{"jsonrpc":"2.0","id":4,"method":"ping"}"#).unwrap();
        assert_eq!(ping["result"], serde_json::json!({}));
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
        assert!(is_reply_to(
            &format!(r#"{{"jsonrpc":"2.0","id":"{id}","result":{{}}}}"#),
            &id
        ));
        assert!(!is_reply_to(r#"{"jsonrpc":"2.0","id":0,"result":{}}"#, &id));
        assert_ne!(handshake.replay().unwrap().1, id);
    }

    #[test]
    fn json_merge_keeps_other_servers() {
        let path = temp("json").join("config.json");
        std::fs::write(
            &path,
            r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#,
        )
        .unwrap();
        merge_json_config(
            path.clone(),
            "/Applications/Precipice.app/Contents/MacOS/p",
            "t",
        )
        .unwrap();
        merge_json_config(
            path.clone(),
            "/Applications/Precipice.app/Contents/MacOS/p",
            "t",
        )
        .unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "x");
        assert_eq!(value["mcpServers"]["precipice"]["args"][0], "--mcp");
    }

    #[test]
    fn install_token_is_written_to_client_env() {
        let path = temp("token").join("config.json");
        merge_json_config(
            path.clone(),
            "/Applications/Precipice.app/Contents/MacOS/p",
            "abc",
        )
        .unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["mcpServers"]["precipice"]["env"][TOKEN_ENV], "abc");
    }

    #[test]
    fn hello_is_recognised_and_bad_tokens_never_verify() {
        assert_eq!(parse_hello(&hello_line(Some("t"))), Some(Some("t".into())));
        assert_eq!(parse_hello(&hello_line(None)), Some(None));
        assert_eq!(
            parse_hello(r#"{"jsonrpc":"2.0","id":0,"method":"initialize"}"#),
            None
        );
        assert!(install_for("../../etc").is_none());
        assert!(install_for(&"z".repeat(32)).is_none());
    }

    #[test]
    fn overlong_lines_drop_the_connection_instead_of_splitting() {
        let mut line = String::new();
        let mut ok = std::io::Cursor::new(b"{\"a\":1}\n".to_vec());
        assert_eq!(read_bounded_line(&mut ok, &mut line), Ok(8));
        let mut big = vec![b'x'; MAX_LINE_BYTES + 10];
        big.push(b'\n');
        let mut long = std::io::Cursor::new(big);
        assert!(read_bounded_line(&mut long, &mut line).is_err());
        let mut exact = vec![b'x'; MAX_LINE_BYTES];
        exact.push(b'\n');
        assert!(read_bounded_line(&mut std::io::Cursor::new(exact), &mut line).is_ok());
    }

    #[test]
    fn write_config_replaces_symlink_target_and_keeps_the_link() {
        let dir = temp("symlink");
        let target = dir.join("real.json");
        let link = dir.join("link.json");
        std::fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        merge_json_config(link.clone(), "p", "t").unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(std::fs::read_to_string(&target)
            .unwrap()
            .contains("precipice"));
    }

    #[test]
    fn refuses_unstable_install_locations() {
        use std::path::Path;
        assert!(unstable_location(Path::new(
            "/Volumes/Precipice/Precipice.app/Contents/MacOS/p"
        )));
        assert!(unstable_location(Path::new(
            "/private/var/folders/x/AppTranslocation/y/d/Precipice.app/Contents/MacOS/p"
        )));
        assert!(unstable_location(Path::new(
            "/Users/a/src/precipice/src-tauri/target/release/p"
        )));
        assert!(!unstable_location(Path::new(
            "/Applications/Precipice.app/Contents/MacOS/p"
        )));
    }

    #[test]
    fn json_merge_refuses_to_overwrite_invalid_files() {
        let path = temp("invalid").join("config.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(merge_json_config(path.clone(), "p", "t").is_err());
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
        merge_codex_config(path.clone(), "/new \"path\"", "tok").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("model = \"o5\""));
        assert!(text.contains("[mcp_servers.other]\ncommand = \"y\""));
        assert!(!text.contains("\"old\""));
        assert_eq!(text.matches("[mcp_servers.precipice]").count(), 1);
        assert_eq!(
            text.parse::<toml_edit::DocumentMut>().unwrap()["mcp_servers"]["precipice"]["command"]
                .as_str(),
            Some("/new \"path\"")
        );
    }
}
