use super::*;
use serde_json::json;

#[test]
fn request_validation_preserves_the_error_envelope() {
    let result = empty_request(json!({"unexpected": true}), || panic!("invalid action ran"));
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"ok": false, "error": {"code": "invalid", "message": "The requested action contains invalid values."}})
    );
}

#[test]
fn void_success_uses_json_null() {
    assert_eq!(
        serde_json::to_value(empty_request(json!({}), || Ok(()))).unwrap(),
        json!({"ok": true, "value": null})
    );
}
