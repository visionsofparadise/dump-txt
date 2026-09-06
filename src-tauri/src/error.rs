use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct IpcFailure {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum IpcResult<T> {
    Success { ok: bool, value: T },
    Failure { ok: bool, error: IpcFailure },
}

impl<T> IpcResult<T> {
    pub fn failure(code: &'static str, message: impl Into<String>) -> Self {
        Self::Failure {
            ok: false,
            error: IpcFailure {
                code,
                message: message.into(),
            },
        }
    }

    pub fn from_result<E: std::fmt::Display>(result: Result<T, E>) -> Self {
        match result {
            Ok(value) => Self::Success { ok: true, value },
            Err(error) => Self::failure("io", error.to_string()),
        }
    }
}

pub fn parse_request<T: DeserializeOwned>(request: serde_json::Value) -> Result<T, IpcFailure> {
    serde_json::from_value(request).map_err(|_| IpcFailure {
        code: "invalid",
        message: "The requested action contains invalid values.".into(),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyRequest {}

pub fn empty_request(
    request: serde_json::Value,
    action: impl FnOnce() -> Result<(), tauri::Error>,
) -> IpcResult<()> {
    match parse_request::<EmptyRequest>(request) {
        Ok(_) => IpcResult::from_result(action()),
        Err(error) => IpcResult::Failure { ok: false, error },
    }
}

#[cfg(test)]
mod tests {
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
}
