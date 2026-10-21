fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_agent_session",
            "save_agent_session",
            "open_agent_signin",
            "read_api_key",
            "save_api_key",
            "remove_api_key",
            "read_typesafe_key",
            "save_typesafe_key",
            "remove_typesafe_key",
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
