use crate::error::IpcFailure;
use std::{fs, path::PathBuf};

pub struct ProfileConfiguration {
    pub config_dir: PathBuf,
    pub isolated_root: Option<PathBuf>,
}

pub fn resolve_profile(configuration: &ProfileConfiguration) -> Result<PathBuf, IpcFailure> {
    let root = configuration
        .isolated_root
        .clone()
        .unwrap_or_else(|| configuration.config_dir.join("dump.txt"));
    if !root.is_absolute() || root.to_str().is_none_or(|value| value.contains('\0')) {
        return Err(IpcFailure {
            code: "invalid",
            message:
                "The document profile must be an absolute Unicode path without NUL characters."
                    .into(),
        });
    }
    if configuration.isolated_root.is_some() {
        return Ok(root);
    }
    for name in ["dump-txt", "com.visionsofparadise.dump-txt"] {
        let candidate = configuration.config_dir.join(name);
        for marker in ["app-state.json", "recovery.json", "dump.txt"] {
            match fs::symlink_metadata(candidate.join(marker)) {
                Ok(_) => {
                    return Err(IpcFailure {
                        code: "conflict",
                        message: format!(
                            "Another dump.txt document profile exists at {}. Select the intended profile explicitly before continuing with {}. Both profiles have been preserved.",
                            candidate.display(),
                            root.display()
                        ),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(IpcFailure {
                        code: if error.kind() == std::io::ErrorKind::PermissionDenied {
                            "permission"
                        } else {
                            "io"
                        },
                        message: format!(
                            "Could not check the document profile at {}: {error}",
                            candidate.display()
                        ),
                    });
                }
            }
        }
    }
    Ok(root)
}

#[cfg(test)]
#[path = "paths.test.rs"]
mod tests;
