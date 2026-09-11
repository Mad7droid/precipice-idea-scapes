fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_api_key",
            "save_api_key",
            "remove_api_key",
        ]),
    ))
    .expect("failed to build desktop app");
}
