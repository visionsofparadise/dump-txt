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
