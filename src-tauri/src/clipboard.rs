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
    match tauri::async_runtime::spawn_blocking(move || app.clipboard().write_text(request.text))
        .await
    {
        Ok(result) => IpcResult::from_result(result),
        Err(error) => IpcResult::failure("io", error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn successful_text_preserves_the_public_envelope() {
        for text in ["", "Café · 中文 · 日本語 · 한글 · 👩‍💻"] {
            assert_eq!(
                serde_json::to_value(clipboard_read_result(Ok(text.into()))).unwrap(),
                json!({"ok": true, "value": text})
            );
        }
    }

    #[test]
    fn unavailable_text_returns_an_empty_success() {
        let result = clipboard_read_result(Err(Error::Clipboard(
            "The clipboard contents were not available in the requested format or the clipboard is empty.".into(),
        )));
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({"ok": true, "value": ""})
        );
    }

    #[test]
    fn other_clipboard_failures_preserve_the_io_envelope() {
        for message in [
            "The selected clipboard is not supported with the current system configuration.",
            "The native clipboard is not accessible due to being held by another party.",
            "The image or the text that was about the be transferred to/from the clipboard could not be converted to the appropriate format.",
            "Unknown error while interacting with the clipboard: NSPasteboard#pasteboardItems errored",
            "The clipboard contents were not available in the requested format or the clipboard is empty. Unexpected failure.",
        ] {
            let result = clipboard_read_result(Err(Error::Clipboard(message.into())));
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                json!({"ok": false, "error": {"code": "io", "message": message}})
            );
        }
    }

    #[test]
    fn matching_text_in_a_tauri_error_remains_an_error() {
        let error = Error::Tauri(tauri::Error::Io(std::io::Error::other(
            CONTENT_NOT_AVAILABLE,
        )));
        let message = error.to_string();
        assert_eq!(
            serde_json::to_value(clipboard_read_result(Err(error))).unwrap(),
            json!({"ok": false, "error": {"code": "io", "message": message}})
        );
    }
}
