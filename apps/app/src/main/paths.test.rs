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
