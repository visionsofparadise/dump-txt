use crate::error::{empty_request, parse_request, IpcResult};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State, WebviewWindow, WindowEvent};

#[derive(Default)]
pub struct WindowState {
    ready: AtomicBool,
    close_requested: AtomicBool,
    allow_close: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn emit_bounds(window: &tauri::Window) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_minimized()? {
        return Ok(());
    }
    let scale = window.scale_factor()?;
    let position = window.outer_position()?.to_logical::<i32>(scale);
    let size = window.outer_size()?.to_logical::<u32>(scale);
    if !(-100000..=100000).contains(&position.x)
        || !(-100000..=100000).contains(&position.y)
        || !(420..=10000).contains(&size.width)
        || !(280..=10000).contains(&size.height)
    {
        return Ok(());
    }
    window.emit(
        "windowBoundsChanged",
        [WindowBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }],
    )
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    let state = window.state::<WindowState>();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if state.allow_close.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if state.ready.load(Ordering::SeqCst) {
                let _ = window.emit("closeRequested", Vec::<bool>::new());
            } else {
                state.close_requested.store(true, Ordering::SeqCst);
            }
        }
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. }
            if state.ready.load(Ordering::SeqCst) =>
        {
            let _ = emit_bounds(window);
            if let Ok(maximized) = window.is_maximized() {
                let _ = window.emit("maximizedChanged", [maximized]);
            }
        }
        _ => {}
    }
}

pub fn restore_existing(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        if app.state::<WindowState>().ready.load(Ordering::SeqCst) {
            let _ = window.show();
        }
        let _ = window.set_focus();
    }
}

pub fn handle_exit_request(app: &tauri::AppHandle, api: &tauri::ExitRequestApi) {
    if !app
        .state::<WindowState>()
        .allow_close
        .load(Ordering::SeqCst)
    {
        if let Some(window) = app.get_webview_window("main") {
            api.prevent_exit();
            let _ = window.close();
        }
    }
}

#[tauri::command]
pub fn minimize(window: WebviewWindow, request: serde_json::Value) -> IpcResult<()> {
    empty_request(request, || window.minimize())
}

#[tauri::command]
pub fn toggle_maximize(window: WebviewWindow, request: serde_json::Value) -> IpcResult<()> {
    empty_request(request, || {
        if window.is_maximized()? {
            window.unmaximize()
        } else {
            window.maximize()
        }
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TitleRequest {
    title: String,
}

#[tauri::command]
pub fn set_title(window: WebviewWindow, request: serde_json::Value) -> IpcResult<()> {
    match parse_request::<TitleRequest>(request) {
        Ok(request) if !request.title.contains('\0') && request.title.len() <= 4096 => {
            IpcResult::from_result(window.set_title(&request.title))
        }
        Ok(_) => IpcResult::failure("invalid", "The window title contains invalid values."),
        Err(error) => IpcResult::Failure { ok: false, error },
    }
}

#[tauri::command]
pub fn finish_close(
    window: WebviewWindow,
    state: State<'_, WindowState>,
    request: serde_json::Value,
) -> IpcResult<()> {
    empty_request(request, || {
        state.allow_close.store(true, Ordering::SeqCst);
        let result = window.close();
        if result.is_err() {
            state.allow_close.store(false, Ordering::SeqCst);
        }
        result
    })
}

#[tauri::command]
pub fn renderer_ready(
    window: WebviewWindow,
    state: State<'_, WindowState>,
    request: serde_json::Value,
) -> IpcResult<()> {
    empty_request(request, || {
        state.ready.store(true, Ordering::SeqCst);
        window.show()?;
        window.set_focus()?;
        window.emit("maximizedChanged", [window.is_maximized()?])?;
        emit_bounds(&window.as_ref().window())?;
        if state.close_requested.swap(false, Ordering::SeqCst) {
            window.emit("closeRequested", Vec::<bool>::new())?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn open_inspector(window: WebviewWindow, request: serde_json::Value) -> IpcResult<()> {
    empty_request(request, || {
        #[cfg(debug_assertions)]
        {
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
            }
            Ok(())
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = window;
            Err(tauri::Error::Io(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "The inspector is available in development builds.",
            )))
        }
    })
}
