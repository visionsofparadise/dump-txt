use crate::error::IpcFailure;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum DocumentRef {
    Path(PathBuf),
    Uri(tauri::Url),
}

impl DocumentRef {
    pub fn parse(value: &str) -> Result<Self, IpcFailure> {
        if value.contains('\0') || value.is_empty() {
            return Err(IpcFailure {
                code: "invalid",
                message: "A document reference is required.".into(),
            });
        }

        if let Ok(url) = tauri::Url::parse(value) {
            if url.scheme().len() > 1 {
                if !matches!(url.scheme(), "content" | "file")
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.fragment().is_some()
                    || (url.scheme() == "content" && url.host_str().is_none())
                {
                    return Err(IpcFailure {
                        code: "invalid",
                        message: "The document URI is unsupported.".into(),
                    });
                }

                return Ok(Self::Uri(url));
            }
        }

        Ok(Self::Path(PathBuf::from(value)))
    }

    pub fn as_text(&self) -> Result<String, IpcFailure> {
        match self {
            Self::Path(path) => crate::files::renderer_path(path),
            Self::Uri(url) => Ok(url.as_str().into()),
        }
    }
}

#[cfg(test)]
#[path = "document.test.rs"]
mod tests;
