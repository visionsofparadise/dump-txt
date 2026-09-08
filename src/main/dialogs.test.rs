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
