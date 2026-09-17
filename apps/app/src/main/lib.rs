#[cfg(all(feature = "automation", target_os = "windows"))]
mod automation;
mod clipboard;
mod dialogs;
mod document;
mod error;
mod file_permissions;
mod files;
#[cfg(not(target_os = "android"))]
mod fonts;
#[cfg(desktop)]
mod menu;
mod paths;
mod startup;
mod window;
#[cfg(desktop)]
mod window_theme;

#[cfg(desktop)]
use std::path::PathBuf;
use std::sync::Arc;
#[cfg(desktop)]
use tauri::Theme;
use tauri::{webview::NewWindowResponse, Manager, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

fn navigation_allowed(url: &tauri::Url, development_origin: Option<&tauri::Url>) -> bool {
    if let Some(origin) = development_origin {
        return url.origin() == origin.origin()
            && matches!(url.path(), "/" | "/index.html" | "/probe.html");
    }

    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    ) && url.port().is_none()
        && matches!(url.path(), "" | "/" | "/index.html" | "/probe.html")
        && url.query().is_none()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder =
        builder
            .enable_macos_default_menu(false)
            .plugin(tauri_plugin_single_instance::init(|app, _, _| {
                window::restore_existing(app);
            }));
    #[cfg(all(desktop, feature = "automation"))]
    let builder = builder.plugin(tauri_plugin_wdio::init());
    #[cfg(all(feature = "automation", target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_documents::init());

    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(window::WindowState::default());
    #[cfg(desktop)]
    let builder = builder
        .manage(menu::MenuState::default())
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            window::handle_window_event(window, event);
            menu::handle_window_event(window, event);
        });

    builder
        .setup(|app| {
            let configuration = app.config();

            #[cfg(desktop)]
            if cfg!(feature = "probe")
                != (configuration.identifier == "com.visionsofparadise.dump-txt.probe")
            {
                return Err("The probe feature and isolated probe identifier must be used together.".into());
            }

            #[cfg(desktop)]
            let isolated = cfg!(feature = "automation") || tauri::is_dev();

            #[cfg(desktop)]
            if !cfg!(feature = "probe")
                && isolated == (configuration.identifier == "com.visionsofparadise.dump-txt")
            {
                return Err("Development and automation require an isolated application identifier.".into());
            }

            let (theme, bounds) = if cfg!(feature = "probe") {
                (startup::StartupTheme::System, None)
            } else {
                let prepared = (|| -> Result<_, Box<dyn std::error::Error>> {
                    #[cfg(mobile)]
                    let isolated_root = None;
                    #[cfg(desktop)]
                    let isolated_root = if isolated {
                        Some(PathBuf::from(std::env::var_os("DUMP_TXT_PROFILE")
                            .ok_or("Development and automation require an explicit DUMP_TXT_PROFILE.")?))
                    } else {
                        None
                    };
                    let profile = paths::resolve_profile(&paths::ProfileConfiguration {
                        config_dir: app.path().config_dir()?,
                        isolated_root,
                    })?;
                    let files = files::FileService::new(profile)?;
                    #[cfg(mobile)]
                    let files = files.with_app(app.handle().clone());
                    let files = Arc::new(files);
                    let startup = startup::StartupState::load(&files, files.user_data().into());

                    Ok((files, startup))
                })();
                let (files, startup) = match prepared {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("The document profile could not open: {error}");

                        #[cfg(desktop)]
                        let handle = app.handle().clone();

                        app.dialog().message(error.to_string())
                            .title("dump.txt could not open")
                            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                            .show(move |_| {
                                #[cfg(desktop)]
                                handle.exit(1);
                            });

                        return Ok(());
                    }
                };
                let values = (startup.theme, startup.window_bounds);

                app.manage(files);
                app.manage(startup);

                values
            };
            let window_config = configuration.app.windows.first().ok_or("The editor window configuration is missing.")?;
            let development_origin = if tauri::is_dev() {
                configuration.build.dev_url.clone()
            } else {
                None
            };
            #[cfg(desktop)]
            let profile = app.path().app_local_data_dir()?.join("webview");
            let window = WebviewWindowBuilder::from_config(app, window_config)?
                .initialization_script(format!("window.dumpPlatform = '{}'; document.addEventListener('DOMContentLoaded', () => {{ document.documentElement.dataset.theme = '{}'; }}, {{ once: true }});", std::env::consts::OS, theme.as_str()))
                .on_navigation(move |url| navigation_allowed(url, development_origin.as_ref()))
                .on_new_window(|_, _| NewWindowResponse::Deny);
            #[cfg(desktop)]
            let window = window
                .theme(match theme {
                    startup::StartupTheme::System => None,
                    startup::StartupTheme::Light => Some(Theme::Light),
                    startup::StartupTheme::Dark => Some(Theme::Dark),
                })
                .data_directory(profile)
                .incognito(cfg!(target_os = "macos") && configuration.identifier != "com.visionsofparadise.dump-txt")
                .devtools(cfg!(debug_assertions));
            #[cfg(target_os = "macos")]
            let window = window
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(14.0, 12.0));
            #[cfg(target_os = "linux")]
            let window = window.decorations(true);
            #[cfg(all(feature = "automation", target_os = "windows"))]
            let window = match automation::browser_arguments()? {
                Some(arguments) => window.additional_browser_args(&arguments),
                None => window,
            };
            let window = window.build()?;

            #[cfg(mobile)]
            let _ = (window, bounds);

            #[cfg(desktop)]
            {
                if let Some(bounds) = bounds {
                    window::restore_bounds(&window, bounds)?;
                }

                let dark = match theme {
                    startup::StartupTheme::System => window.theme()? == Theme::Dark,
                    startup::StartupTheme::Light => false,
                    startup::StartupTheme::Dark => true,
                };
                let color = if dark {
                    tauri::window::Color(44, 44, 44, 255)
                } else {
                    tauri::window::Color(250, 250, 250, 255)
                };

                window.set_background_color(Some(color))?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(desktop)]
            window::minimize,
            #[cfg(desktop)]
            window::toggle_maximize,
            #[cfg(desktop)]
            window::set_title,
            #[cfg(desktop)]
            window::finish_close,
            window::renderer_ready,
            #[cfg(desktop)]
            window::open_inspector,
            #[cfg(desktop)]
            window_theme::set_theme,
            #[cfg(not(target_os = "android"))]
            fonts::get_system_fonts,
            clipboard::read_clipboard,
            clipboard::write_clipboard,
            #[cfg(desktop)]
            menu::show_text_context_menu,
            startup::get_paths,
            files::read_file,
            files::write_file,
            dialogs::show_open_dialog,
            dialogs::show_save_dialog
        ])
        .build(tauri::generate_context!())
        .expect("The dump.txt shell could not start")
        .run(|app, event| {
            #[cfg(mobile)]
            let _ = (app, event);

            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                window::handle_exit_request(app, &api);
            }
        });
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
