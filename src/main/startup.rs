use crate::{
    error::{parse_request, EmptyRequest, IpcFailure, IpcResult},
    files::{renderer_path, FileRead, FileService},
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::State;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowBounds {
    fn valid(&self) -> bool {
        (-100000..=100000).contains(&self.x)
            && (-100000..=100000).contains(&self.y)
            && (420..=10000).contains(&self.width)
            && (280..=10000).contains(&self.height)
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StartupTheme {
    #[default]
    System,
    Light,
    Dark,
}

impl StartupTheme {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoredSettings {
    version: u32,
    active_path: String,
    window_bounds: Option<WindowBounds>,
}

pub struct StartupState {
    user_data: PathBuf,
    restored_file_path: Option<PathBuf>,
    pub theme: StartupTheme,
    pub window_bounds: Option<WindowBounds>,
    settings: Mutex<Option<Option<FileRead>>>,
}

impl StartupState {
    pub fn load(files: &FileService, user_data: PathBuf) -> Self {
        let settings = files.read_snapshot(&user_data.join("app-state.json")).ok();
        let decoded = settings
            .as_ref()
            .and_then(Option::as_ref)
            .and_then(|snapshot| serde_json::from_slice::<serde_json::Value>(&snapshot.bytes).ok());
        let theme = decoded
            .as_ref()
            .and_then(|value| value.get("appearance"))
            .and_then(|appearance| appearance.get("theme"))
            .and_then(|theme| serde_json::from_value(theme.clone()).ok())
            .unwrap_or_default();
        let restored = decoded
            .and_then(|value| serde_json::from_value::<RestoredSettings>(value).ok())
            .filter(|state| {
                state.version == 1
                    && !state.active_path.is_empty()
                    && state.window_bounds.as_ref().is_none_or(WindowBounds::valid)
            });
        let restored_file_path = restored
            .as_ref()
            .and_then(|state| files.grant_path(state.active_path.as_ref(), true).ok());
        let window_bounds = restored_file_path
            .as_ref()
            .and_then(|_| restored.as_ref().and_then(|state| state.window_bounds));
        Self {
            user_data,
            restored_file_path,
            theme,
            window_bounds,
            settings: Mutex::new(settings),
        }
    }

    pub fn take_paths(&self) -> Result<AppPaths, IpcFailure> {
        let user_data = renderer_path(&self.user_data)?;
        let restored_file_path = self
            .restored_file_path
            .as_deref()
            .map(renderer_path)
            .transpose()?;
        let startup_settings = self
            .settings
            .lock()
            .map_err(|_| IpcFailure {
                code: "io",
                message: "The startup settings snapshot is unavailable.".into(),
            })?
            .take();
        Ok(AppPaths {
            user_data,
            restored_file_path,
            startup_settings,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub user_data: String,
    pub restored_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_settings: Option<Option<FileRead>>,
}

#[tauri::command]
pub fn get_paths(
    state: State<'_, StartupState>,
    request: serde_json::Value,
) -> IpcResult<AppPaths> {
    let result = parse_request::<EmptyRequest>(request).and_then(|_| state.take_paths());
    match result {
        Ok(value) => IpcResult::Success { ok: true, value },
        Err(error) => IpcResult::Failure { ok: false, error },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_settings_are_null_once_then_omitted() {
        let fixture = tempfile::tempdir().unwrap();
        let files = FileService::new(fixture.path().into()).unwrap();
        let startup = StartupState::load(&files, fixture.path().into());
        let first = serde_json::to_value(startup.take_paths().unwrap()).unwrap();
        assert_eq!(first["startupSettings"], serde_json::Value::Null);
        assert!(first.get("startupSettings").is_some());
        let second = serde_json::to_value(startup.take_paths().unwrap()).unwrap();
        assert!(second.get("startupSettings").is_none());
    }

    #[test]
    fn corrupt_settings_keep_the_exact_cached_bytes_and_hash() {
        let fixture = tempfile::tempdir().unwrap();
        let path = fixture.path().join("app-state.json");
        let bytes = b"\xff{ corrupt settings";
        fs::write(&path, bytes).unwrap();
        let files = FileService::new(fixture.path().into()).unwrap();
        let expected_hash = files.read_snapshot(&path).unwrap().unwrap().hash;
        let startup = StartupState::load(&files, fixture.path().into());
        fs::write(&path, b"changed after startup").unwrap();
        let first = startup.take_paths().unwrap();
        let snapshot = first.startup_settings.unwrap().unwrap();
        assert_eq!(snapshot.bytes, bytes);
        assert_eq!(snapshot.hash, expected_hash);
        assert!(first.restored_file_path.is_none());
        assert_eq!(startup.theme, StartupTheme::System);
    }

    #[test]
    fn unavailable_restored_document_keeps_its_native_grant() {
        let fixture = tempfile::tempdir().unwrap();
        let profile = fixture.path().join("profile");
        fs::create_dir(&profile).unwrap();
        let active = fixture.path().join("unavailable").join("work.txt");
        fs::write(
            profile.join("app-state.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "activePath": active,
                "appearance": {"theme":"dark"},
                "windowBounds": {"x": 10, "y": -20, "width": 960, "height": 640}
            }))
            .unwrap(),
        )
        .unwrap();
        let files = FileService::new(profile.clone()).unwrap();
        let startup = StartupState::load(&files, profile);
        assert_eq!(startup.theme, StartupTheme::Dark);
        assert_eq!(startup.window_bounds.unwrap().y, -20);
        assert!(startup.take_paths().unwrap().restored_file_path.is_some());
        assert!(files.read_snapshot(&active).unwrap().is_none());
    }

    #[test]
    fn invalid_native_settings_never_grant_external_documents() {
        for version in [0, 2] {
            let fixture = tempfile::tempdir().unwrap();
            let profile = fixture.path().join("profile");
            fs::create_dir(&profile).unwrap();
            let active = fixture.path().join("private.txt");
            fs::write(&active, b"fixture").unwrap();
            fs::write(
                profile.join("app-state.json"),
                serde_json::to_vec(&serde_json::json!({
                    "version": version,
                    "activePath": active,
                    "appearance": {"theme":"light"}
                }))
                .unwrap(),
            )
            .unwrap();
            let files = FileService::new(profile.clone()).unwrap();
            let startup = StartupState::load(&files, profile);
            assert!(startup.take_paths().unwrap().restored_file_path.is_none());
            assert!(files.read_snapshot(&active).is_err());
            assert_eq!(startup.theme, StartupTheme::Light);
        }
    }

    #[test]
    fn failed_initial_read_is_omitted_to_allow_retry() {
        let fixture = tempfile::tempdir().unwrap();
        let path = fixture.path().join("app-state.json");
        fs::create_dir(&path).unwrap();
        let files = FileService::new(fixture.path().into()).unwrap();
        let startup = StartupState::load(&files, fixture.path().into());
        let first = serde_json::to_value(startup.take_paths().unwrap()).unwrap();
        assert!(first.get("startupSettings").is_none());
        fs::remove_dir(&path).unwrap();
        fs::write(&path, b"{}").unwrap();
        assert_eq!(files.read_snapshot(&path).unwrap().unwrap().bytes, b"{}");
    }
}
