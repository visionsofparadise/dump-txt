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
