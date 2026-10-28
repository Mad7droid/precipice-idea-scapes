fn main() {
    // The agent sign-in host is derived from this at compile time.
    println!("cargo:rerun-if-env-changed=VITE_MCP_URL");
    // The helper (`--mcp`) runs without the Tauri context, so the socket path is derived from
    // the bundle identifier at compile time; the app asserts the two agree at startup.
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let conf: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").expect("tauri.conf.json"))
            .expect("valid tauri.conf.json");
    let identifier = conf["identifier"]
        .as_str()
        .expect("identifier in tauri.conf.json");
    println!("cargo:rustc-env=PRECIPICE_IDENTIFIER={identifier}");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "chatgpt_status",
            "chatgpt_connect",
            "chatgpt_disconnect",
            "chatgpt_cancel_login",
            "chatgpt_select",
            "chatgpt_request",
            "ai_cancel",
            "claude_status",
            "claude_connect",
            "claude_request",
            "open_ai_settings",
            "keychain_retry",
            "keychain_reset",
            "read_agent_session",
            "save_agent_session",
            "open_agent_signin",
            "open_external",
            "quit_ready",
            "mcp_status",
            "read_api_key",
            "save_api_key",
            "remove_api_key",
            "read_typesafe_key",
            "save_typesafe_key",
            "remove_typesafe_key",
            "jev_route",
            "mcp_ready",
            "mcp_send",
            "mcp_install_client",
            "mcp_helper_path",
            "dictation_status",
            "dictation_install",
            "dictation_cancel_install",
            "dictation_prepare",
            "dictation_start",
            "dictation_stop",
            "dictation_cancel",
        ]),
    ))
    .expect("failed to build desktop app");
}
