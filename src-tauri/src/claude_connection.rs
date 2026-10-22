//! Claude Code is used only as a text/JSON model. It cannot run its own canvas, shell or MCP tools.
use crate::ai_connection::Connections;
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn executable() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    [
        home.join(".local/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}
fn command() -> Result<tokio::process::Command, String> {
    let path=executable().ok_or("Install Claude Code from https://claude.ai/install.sh, then run claude auth login in Terminal.")?;
    isolated_command(&path)
}
fn isolated_command(path: &std::path::Path) -> Result<tokio::process::Command, String> {
    let mut command = tokio::process::Command::new(path);
    // Never inherit an API key, a provider override, injected runtime code, or a parent agent session.
    let home = std::env::var_os("HOME").ok_or("Could not locate your home directory.")?;
    command
        .env_clear()
        .env("HOME", &home)
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // Claude's macOS Keychain account lookup needs these OS identity fields.
    for name in ["USER", "LOGNAME"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    Ok(command)
}
async fn output(
    mut command: tokio::process::Command,
    prompt: Option<String>,
) -> Result<Value, String> {
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start Claude Code. Check its installation.")?;
    let mut stdin = child.stdin.take().ok_or("Could not open Claude input.")?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Could not read Claude response.")?
        .take(2 * 1024 * 1024 + 1);
    let write = async {
        if let Some(prompt) = prompt {
            stdin
                .write_all(prompt.as_bytes())
                .await
                .map_err(|_| "Could not send request to Claude.")?;
        }
        drop(stdin);
        Ok::<(), String>(())
    };
    let read = async {
        let mut bytes = Vec::new();
        stdout
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Could not read Claude response.")?;
        Ok::<_, String>(bytes)
    };
    let (_, bytes) = tokio::try_join!(write, read)?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Claude response exceeded its limit.".into());
    }
    let status = child
        .wait()
        .await
        .map_err(|_| "Claude process stopped unexpectedly.")?;
    let value:Value=serde_json::from_slice(&bytes).map_err(|_|"Claude returned no valid response. Run claude auth login in Terminal, or upgrade Claude Code.")?;
    // `auth status` uses exit 1 for an ordinary signed-out account.
    if value["loggedIn"] == false
        && value["authMethod"] == "none"
        && value.get("is_error").is_none()
    {
        return Ok(value);
    }
    if value["api_error_status"] == 429 {
        return Err("Claude plan usage limit reached. Check your usage in Claude and try after the limit resets.".into());
    }
    if value["api_error_status"] == 401 || value["api_error_status"] == 403 {
        return Err(
            "Claude sign-in expired or access was denied. Sign in again in Settings → AI.".into(),
        );
    }
    if !status.success() || value["is_error"] == true {
        return Err("Claude could not complete this request. Check your Claude plan usage and run claude auth status in Terminal.".into());
    }
    Ok(value)
}
#[tauri::command]
pub async fn claude_status() -> Result<Value, String> {
    if executable().is_none() {
        return Ok(json!({"installed":false,"connected":false}));
    }
    let mut cmd = command()?;
    cmd.args(["auth", "status", "--json"]);
    let status = tokio::time::timeout(Duration::from_secs(15), output(cmd, None))
        .await
        .map_err(|_| "Claude connection check timed out.")??;
    let connected = plan_connected(&status);
    Ok(
        json!({"installed":true,"connected":connected,"email":if connected{status["email"].clone()}else{Value::Null},
            "connectionId":if connected{json!(crate::ai_connection::digest(&format!("{}:{}",status["email"],status["orgId"])))}else{Value::Null}}),
    )
}
fn plan_connected(status: &Value) -> bool {
    status["loggedIn"] == true
        && status["authMethod"] == "claude.ai"
        && status["apiProvider"] == "firstParty"
}
#[tauri::command]
pub async fn claude_connect(state: State<'_, Connections>, id: String) -> Result<(), String> {
    let cancel = state.register(&id).await?;
    let result = tokio::select! {biased;
        _=cancel.notified()=>Err("Claude sign-in cancelled.".into()),
        result=async {
    let mut cmd = command()?;
    cmd.args(["auth", "login", "--claudeai"])
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    let mut child = cmd
        .spawn()
        .map_err(|_| "Could not start Claude sign-in. Run claude auth login in Terminal.")?;
    let status = tokio::time::timeout(Duration::from_secs(300), child.wait())
        .await
        .map_err(|_| "Claude sign-in expired. Try again.")?
        .map_err(|_| "Claude sign-in stopped. Try again.")?;
    if status.success() {
        Ok(())
    } else {
        Err(
            "Claude sign-in did not complete. Run claude auth login in Terminal to try again."
                .into(),
        )
    }
        }=>result
    };
    state.unregister(&id).await;
    result
}
fn validate(model: &str, prompt: &str, schema: &Value) -> Result<(), String> {
    if !["sonnet", "haiku", "opus"].contains(&model) {
        return Err("Choose a supported Claude plan model.".into());
    }
    if prompt.is_empty() || prompt.len() > 2 * 1024 * 1024 || schema.to_string().len() > 256 * 1024
    {
        return Err("Request too large. Use a smaller selection.".into());
    }
    if schema["type"] != "object" {
        return Err("Invalid Claude response schema.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn claude_request(
    state: State<'_, Connections>,
    id: String,
    connection_id: String,
    model: String,
    prompt: String,
    schema: Value,
) -> Result<Value, String> {
    validate(&model, &prompt, &schema)?;
    let cancel = state.register(&id).await?;
    let result = tokio::select! {biased;
        _=cancel.notified()=>Err("Request cancelled.".into()),
        result=tokio::time::timeout(Duration::from_secs(180),async {
            // Refuse API-backed Claude Code sessions so the plan option cannot silently bill API usage.
            let status=claude_status().await?;
            if status["connected"]!=true {return Err("Sign in to your Claude plan with claude auth login in Terminal, then check the connection.".into());}
            if status["connectionId"].as_str()!=Some(connection_id.as_str()) {return Err("Claude account changed. Send the request again.".into());}
            let mut cmd=command()?;
            cmd.args(["--safe-mode","--restricted","-p","--tools","","--strict-mcp-config","--mcp-config","{\"mcpServers\":{}}",
                "--setting-sources","","--no-session-persistence","--model",&model,"--max-turns","3",
                "--output-format","json","--json-schema",&schema.to_string()]);
            let value=output(cmd,Some(prompt)).await?;
            value.get("structured_output").filter(|v|v.is_object()).cloned()
                .ok_or_else(||"Claude returned no structured answer. Retry or upgrade Claude Code.".into())
        })=>result.unwrap_or_else(|_|Err("Claude took too long. Try a smaller request.".into()))
    };
    state.unregister(&id).await;
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_arbitrary_models_and_oversize_requests() {
        let schema = json!({"type":"object"});
        assert!(validate("sonnet", "hello", &schema).is_ok());
        assert!(validate("--dangerous", "hello", &schema).is_err());
        assert!(validate("sonnet", "", &schema).is_err());
        assert!(validate("sonnet", &"x".repeat(2 * 1024 * 1024 + 1), &schema).is_err());
    }
    #[test]
    fn commands_never_inherit_provider_or_code_injection_environment() {
        let cmd = isolated_command(std::path::Path::new("/usr/bin/false")).unwrap();
        let env: Vec<_> = cmd
            .as_std()
            .get_envs()
            .filter_map(|(k, v)| v.map(|_| k.to_string_lossy().to_string()))
            .collect();
        assert!(env
            .iter()
            .all(|name| ["HOME", "PATH", "USER", "LOGNAME"].contains(&name.as_str())));
        assert!(env.contains(&"HOME".into()) && env.contains(&"PATH".into()));
        if std::env::var_os("USER").is_some() {
            assert!(env.contains(&"USER".into()));
        }
    }
    #[test]
    fn rejects_api_and_other_provider_sessions_for_the_plan_option() {
        let good = json!({"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"});
        assert!(plan_connected(&good));
        for (key, value) in [
            ("loggedIn", json!(false)),
            ("authMethod", json!("api_key")),
            ("apiProvider", json!("bedrock")),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(!plan_connected(&bad));
        }
    }
    #[tokio::test]
    async fn subprocess_protocol_handles_success_and_safe_errors() {
        async fn fixture(text: &str) -> Result<Value, String> {
            let mut command = isolated_command(std::path::Path::new("/usr/bin/printf"))?;
            command.args(["%s", text]);
            output(command, None).await
        }
        assert_eq!(
            fixture("{\"structured_output\":{\"text\":\"hello\",\"calls\":[]}}")
                .await
                .unwrap()["structured_output"]["text"],
            "hello"
        );
        let limited = fixture(
            "{\"is_error\":true,\"api_error_status\":429,\"result\":\"PRIVATE DIAGNOSTIC\"}",
        )
        .await
        .unwrap_err();
        assert!(limited.contains("usage limit"));
        assert!(!limited.contains("PRIVATE"));
        let expired = fixture("{\"is_error\":true,\"api_error_status\":401}")
            .await
            .unwrap_err();
        assert!(expired.contains("Sign in again"));
        assert!(fixture("not JSON").await.is_err());
    }
    #[tokio::test]
    async fn subprocess_output_is_bounded() {
        let mut command = isolated_command(std::path::Path::new("/usr/bin/head")).unwrap();
        command.args(["-c", "2097154", "/dev/zero"]);
        assert!(output(command, None)
            .await
            .unwrap_err()
            .contains("exceeded"));
    }
}
