use crate::{
    error::{parse_request, IpcResult},
    startup::StartupTheme,
};
use serde::Deserialize;
use tauri::{Theme, WebviewWindow};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ThemeRequest {
    theme: StartupTheme,
}

#[tauri::command]
pub fn set_theme(window: WebviewWindow, request: serde_json::Value) -> IpcResult<()> {
    let request = match parse_request::<ThemeRequest>(request) {
        Ok(request) => request,
        Err(error) => return IpcResult::Failure { ok: false, error },
    };
    let theme = match request.theme {
        StartupTheme::System => None,
        StartupTheme::Light => Some(Theme::Light),
        StartupTheme::Dark => Some(Theme::Dark),
    };
    IpcResult::from_result(window.set_theme(theme))
}
