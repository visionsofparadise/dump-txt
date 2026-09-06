mod clipboard;
mod error;
mod fonts;
mod menu;
mod window;

use tauri::{webview::NewWindowResponse, Manager, Theme, WebviewWindowBuilder};

fn navigation_allowed(url: &tauri::Url, development_origin: Option<&tauri::Url>) -> bool {
    if let Some(origin) = development_origin {
        return url.origin() == origin.origin()
            && matches!(url.path(), "/" | "/index.html" | "/probe.html");
    }
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    ) && url.port().is_none()
        && matches!(url.path(), "/" | "/index.html" | "/probe.html")
        && url.query().is_none()
}

pub fn run() {
    let builder = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            window::restore_existing(app);
        }));
    #[cfg(feature = "automation")]
    let builder = builder.plugin(tauri_plugin_wdio::init());
    #[cfg(all(feature = "automation", target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(window::WindowState::default())
        .manage(menu::MenuState::default())
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            window::handle_window_event(window, event);
            menu::handle_window_event(window, event);
        })
        .setup(|app| {
            let configuration = app.config();
            if cfg!(feature = "probe")
                != (configuration.identifier == "com.visionsofparadise.dump-txt.probe")
            {
                return Err("The probe feature and isolated probe identifier must be used together.".into());
            }
            let window_config = configuration.app.windows.first().ok_or("The editor window configuration is missing.")?;
            let development_origin = if tauri::is_dev() {
                configuration.build.dev_url.clone()
            } else {
                None
            };
            let profile = app.path().app_local_data_dir()?.join("webview");
            let window = WebviewWindowBuilder::from_config(app, window_config)?
                .data_directory(profile)
                .incognito(cfg!(target_os = "macos") && configuration.identifier != "com.visionsofparadise.dump-txt")
                .initialization_script("document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = 'system'; }, { once: true });")
                .on_navigation(move |url| navigation_allowed(url, development_origin.as_ref()))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .devtools(cfg!(debug_assertions))
                .build()?;
            let color = if window.theme()? == Theme::Dark {
                tauri::window::Color(44, 44, 44, 255)
            } else {
                tauri::window::Color(250, 250, 250, 255)
            };
            window.set_background_color(Some(color))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::minimize,
            window::toggle_maximize,
            window::set_title,
            window::finish_close,
            window::renderer_ready,
            window::open_inspector,
            fonts::get_system_fonts,
            clipboard::read_clipboard,
            clipboard::write_clipboard,
            menu::show_text_context_menu
        ])
        .build(tauri::generate_context!())
        .expect("The dump.txt desktop shell could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                window::handle_exit_request(app, &api);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_navigation_stays_on_the_bundled_entry() {
        assert!(navigation_allowed(
            &"tauri://localhost/probe.html".parse().unwrap(),
            None
        ));
        assert!(navigation_allowed(
            &"http://tauri.localhost/index.html".parse().unwrap(),
            None
        ));
        for url in [
            "https://example.com",
            "file:///etc/passwd",
            "http://localhost:1420/probe.html",
            "tauri://localhost/other.html",
        ] {
            assert!(!navigation_allowed(&url.parse().unwrap(), None), "{url}");
        }
    }

    #[test]
    fn development_navigation_requires_the_exact_server_origin() {
        let origin = "http://localhost:1420".parse().unwrap();
        assert!(navigation_allowed(
            &"http://localhost:1420/probe.html".parse().unwrap(),
            Some(&origin)
        ));
        assert!(!navigation_allowed(
            &"http://localhost:9999/probe.html".parse().unwrap(),
            Some(&origin)
        ));
    }
}
