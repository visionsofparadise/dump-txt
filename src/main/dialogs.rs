use crate::{
    error::{parse_request, IpcFailure, IpcResult},
    files::{renderer_path, FileService},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileDialogOptions {
    title: Option<String>,
    default_path: Option<String>,
    filters: Option<Vec<FileFilter>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

impl FileDialogOptions {
    fn parse(request: serde_json::Value) -> Result<Self, IpcFailure> {
        let options = parse_request::<Self>(request)?;
        if options
            .title
            .iter()
            .chain(options.default_path.iter())
            .any(|value| value.contains('\0'))
        {
            return Err(IpcFailure {
                code: "invalid",
                message: "File dialog options cannot contain NUL characters.".into(),
            });
        }
        if options.filters.as_ref().is_some_and(|filters| {
            filters.iter().any(|filter| {
                filter.name.is_empty()
                    || filter.name.contains('\0')
                    || filter.extensions.is_empty()
                    || filter.extensions.iter().any(|extension| {
                        extension != "*"
                            && (extension.is_empty()
                                || !extension
                                    .chars()
                                    .all(|character| character.is_ascii_alphanumeric()))
                    })
            })
        }) {
            return Err(IpcFailure {
                code: "invalid",
                message: "File dialog filters are invalid.".into(),
            });
        }
        Ok(options)
    }
}

#[derive(Debug, Serialize)]
pub struct DialogSelection {
    path: String,
    hash: Option<String>,
}

fn dialog_hint(path: &Path) -> (Option<PathBuf>, Option<String>) {
    if path.is_dir() {
        return (Some(path.into()), None);
    }
    (
        path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(Path::to_path_buf),
        path.file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned),
    )
}

fn selection_of(
    files: &FileService,
    selection: Option<FilePath>,
) -> Result<Option<DialogSelection>, IpcFailure> {
    let Some(selection) = selection else {
        return Ok(None);
    };
    let selected_path = selection.into_path().map_err(|error| IpcFailure {
        code: "invalid",
        message: format!("The file dialog returned an unsupported path: {error}"),
    })?;
    let path = files.grant_path(&selected_path, false)?;
    let serialized_path = renderer_path(&path)?;
    let hash = files.read_snapshot(&path)?.map(|snapshot| snapshot.hash);
    Ok(Some(DialogSelection {
        path: serialized_path,
        hash,
    }))
}

async fn show_dialog(
    window: WebviewWindow,
    files: Arc<FileService>,
    request: serde_json::Value,
    save: bool,
) -> Result<Option<DialogSelection>, IpcFailure> {
    let options = FileDialogOptions::parse(request)?;
    let mut dialog = window.dialog().file().set_parent(&window);
    if let Some(title) = options.title {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = options.default_path {
        let (directory, name) = dialog_hint(default_path.as_ref());
        if let Some(directory) = directory {
            dialog = dialog.set_directory(directory);
        }
        if let Some(name) = name {
            dialog = dialog.set_file_name(name);
        }
    }
    let (sender, receiver) = mpsc::channel();
    let selected = move |selection| {
        let _ = sender.send(selection);
    };
    if let Some(filters) = options.filters {
        for filter in filters {
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(filter.name, &extensions);
        }
    } else if save {
        dialog = dialog.add_filter("Text files", &["txt"]);
    }
    if save {
        dialog.save_file(selected);
    } else {
        dialog.pick_file(selected);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selection = receiver.recv().map_err(|error| IpcFailure {
            code: "io",
            message: format!("The native file dialog did not return a selection: {error}"),
        })?;
        selection_of(&files, selection)
    })
    .await
    .map_err(|error| IpcFailure {
        code: "io",
        message: format!("The native file dialog could not finish: {error}"),
    })?
}

#[tauri::command]
pub async fn show_open_dialog(
    window: WebviewWindow,
    request: serde_json::Value,
) -> IpcResult<Option<DialogSelection>> {
    let files = Arc::clone(window.state::<Arc<FileService>>().inner());
    match show_dialog(window, files, request, false).await {
        Ok(value) => IpcResult::Success { ok: true, value },
        Err(error) => IpcResult::Failure { ok: false, error },
    }
}

#[tauri::command]
pub async fn show_save_dialog(
    window: WebviewWindow,
    request: serde_json::Value,
) -> IpcResult<Option<DialogSelection>> {
    let files = Arc::clone(window.state::<Arc<FileService>>().inner());
    match show_dialog(window, files, request, true).await {
        Ok(value) => IpcResult::Success { ok: true, value },
        Err(error) => IpcResult::Failure { ok: false, error },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn options_reject_nul_before_native_dialog_creation() {
        for options in [
            serde_json::json!({"title":"broken\0title"}),
            serde_json::json!({"defaultPath":"broken\0path"}),
            serde_json::json!({"unexpected":true}),
        ] {
            assert_eq!(
                FileDialogOptions::parse(options).err().unwrap().code,
                "invalid"
            );
        }
        assert!(FileDialogOptions::parse(serde_json::json!({})).is_ok());
    }

    #[test]
    fn cancellation_and_default_hints_never_grant_paths() {
        let fixture = tempfile::tempdir().unwrap();
        let profile = fixture.path().join("profile");
        fs::create_dir(&profile).unwrap();
        let document = fixture.path().join("external.txt");
        fs::write(&document, b"fixture").unwrap();
        let files = FileService::new(profile).unwrap();
        assert_eq!(
            dialog_hint(&document),
            (Some(fixture.path().into()), Some("external.txt".into()))
        );
        assert!(selection_of(&files, None).unwrap().is_none());
        assert!(files.read_snapshot(&document).is_err());
    }

    #[test]
    fn native_selection_grants_exact_path_and_returns_current_hash() {
        let fixture = tempfile::tempdir().unwrap();
        let profile = fixture.path().join("profile");
        fs::create_dir(&profile).unwrap();
        let document = fixture.path().join("extensionless");
        fs::write(&document, b"current bytes").unwrap();
        let sibling = fixture.path().join("unselected.txt");
        fs::write(&sibling, b"separate fixture").unwrap();
        let files = FileService::new(profile).unwrap();
        let choice = selection_of(&files, Some(document.clone().into()))
            .unwrap()
            .unwrap();
        let snapshot = files.read_snapshot(&document).unwrap().unwrap();
        assert_eq!(choice.hash, Some(snapshot.hash));
        assert!(files.read_snapshot(&sibling).is_err());
        assert_eq!(
            Path::new(&choice.path).file_name().unwrap(),
            "extensionless"
        );
    }

    #[test]
    fn new_selected_path_returns_null_hash_without_creating_document() {
        let fixture = tempfile::tempdir().unwrap();
        let profile = fixture.path().join("profile");
        fs::create_dir(&profile).unwrap();
        let document = fixture.path().join("new.txt");
        let files = FileService::new(profile).unwrap();
        let choice = selection_of(&files, Some(document.clone().into()))
            .unwrap()
            .unwrap();
        assert!(choice.hash.is_none());
        assert!(!document.exists());
    }
}
