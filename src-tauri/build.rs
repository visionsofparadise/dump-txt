fn main() {
    let commands = &[
        "minimize",
        "toggle_maximize",
        "set_title",
        "set_theme",
        "finish_close",
        "renderer_ready",
        "open_inspector",
        "get_system_fonts",
        "read_clipboard",
        "write_clipboard",
        "show_text_context_menu",
        "get_paths",
        "read_file",
        "write_file",
        "show_open_dialog",
        "show_save_dialog",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("The Tauri application configuration must be valid");
}
