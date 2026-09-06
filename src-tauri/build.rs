fn main() {
    let commands = &[
        "minimize",
        "toggle_maximize",
        "set_title",
        "finish_close",
        "renderer_ready",
        "open_inspector",
        "get_system_fonts",
        "read_clipboard",
        "write_clipboard",
        "show_text_context_menu",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("The Tauri application configuration must be valid");
}
