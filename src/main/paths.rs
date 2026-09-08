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
mod tests {
    use super::*;

    #[test]
    fn released_identity_selects_the_legacy_root_without_creating_it() {
        let fixture = tempfile::tempdir().unwrap();
        let expected = fixture.path().join("dump.txt");
        assert_eq!(
            resolve_profile(&ProfileConfiguration {
                config_dir: fixture.path().into(),
                isolated_root: None,
            })
            .unwrap(),
            expected
        );
        assert!(!expected.exists());
    }

    #[test]
    fn ambiguous_document_profiles_are_preserved_without_reading_contents() {
        let fixture = tempfile::tempdir().unwrap();
        let alternative = fixture.path().join("dump-txt");
        fs::create_dir(&alternative).unwrap();
        fs::create_dir(alternative.join("app-state.json")).unwrap();
        let error = resolve_profile(&ProfileConfiguration {
            config_dir: fixture.path().into(),
            isolated_root: None,
        })
        .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert!(alternative.join("app-state.json").is_dir());
        assert!(!fixture.path().join("dump.txt").exists());
    }

    #[test]
    fn isolated_profiles_skip_personal_discovery() {
        let fixture = tempfile::tempdir().unwrap();
        let profile = fixture.path().join("test-profile");
        assert_eq!(
            resolve_profile(&ProfileConfiguration {
                config_dir: PathBuf::from("unavailable-personal-root"),
                isolated_root: Some(profile.clone()),
            })
            .unwrap(),
            profile
        );
        assert!(!profile.exists());
        assert_eq!(
            resolve_profile(&ProfileConfiguration {
                config_dir: fixture.path().into(),
                isolated_root: Some(PathBuf::from("relative")),
            })
            .unwrap_err()
            .code,
            "invalid"
        );
    }
}
