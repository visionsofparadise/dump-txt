use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct IpcFailure {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for IpcFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for IpcFailure {}

impl From<std::io::Error> for IpcFailure {
    fn from(error: std::io::Error) -> Self {
        Self {
            code: match error.kind() {
                std::io::ErrorKind::NotFound => "missing",
                std::io::ErrorKind::PermissionDenied => "permission",
                _ => "io",
            },
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum IpcResult<T> {
    Success { ok: bool, value: T },
    Failure { ok: bool, error: IpcFailure },
}

impl<T> IpcResult<T> {
    pub fn from_join_result<E: std::fmt::Display>(
        result: Result<Result<T, E>, tauri::Error>,
    ) -> Self {
        match result {
            Ok(result) => Self::from_result(result),
            Err(error) => Self::failure("io", error.to_string()),
        }
    }

    pub fn from_ipc_result(result: Result<T, IpcFailure>) -> Self {
        match result {
            Ok(value) => Self::Success { ok: true, value },
            Err(error) => Self::Failure { ok: false, error },
        }
    }

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
#[path = "error.test.rs"]
mod tests;
