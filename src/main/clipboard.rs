use crate::error::{parse_request, EmptyRequest, IpcResult};
use serde::Deserialize;
use tauri_plugin_clipboard_manager::{ClipboardExt, Error};

const CONTENT_NOT_AVAILABLE: &str =
    "The clipboard contents were not available in the requested format or the clipboard is empty.";

fn clipboard_read_result(
    result: tauri_plugin_clipboard_manager::Result<String>,
) -> IpcResult<String> {
    match result {
        Err(Error::Clipboard(message)) if message == CONTENT_NOT_AVAILABLE => IpcResult::Success {
            ok: true,
            value: String::new(),
        },
        result => IpcResult::from_result(result),
    }
}

#[tauri::command]
pub async fn read_clipboard(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> IpcResult<String> {
    if let Err(error) = parse_request::<EmptyRequest>(request) {
        return IpcResult::Failure { ok: false, error };
    }

    match tauri::async_runtime::spawn_blocking(move || app.clipboard().read_text()).await {
        Ok(result) => clipboard_read_result(result),
        Err(error) => IpcResult::failure("io", error.to_string()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteClipboardRequest {
    text: String,
}

#[tauri::command]
pub async fn write_clipboard(app: tauri::AppHandle, request: serde_json::Value) -> IpcResult<()> {
    let request = match parse_request::<WriteClipboardRequest>(request) {
        Ok(request) => request,
        Err(error) => return IpcResult::Failure { ok: false, error },
    };

    IpcResult::from_join_result(
        tauri::async_runtime::spawn_blocking(move || app.clipboard().write_text(request.text))
            .await,
    )
}

#[cfg(test)]
#[path = "clipboard.test.rs"]
mod tests;
