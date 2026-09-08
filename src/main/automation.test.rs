use super::*;

#[test]
fn no_profile_leaves_browser_defaults_untouched() {
    assert_eq!(arguments_for_profile(None).unwrap(), None);
}

#[test]
fn explicit_profile_keeps_defaults_and_contains_loopback_diagnostics() {
    let arguments = arguments_for_profile(Some(r"C:\test profiles\fixture".into()))
        .unwrap()
        .unwrap();
    assert!(arguments.starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required "));
    assert!(arguments.contains("--remote-debugging-port=0 --remote-debugging-address=127.0.0.1"));
    assert!(arguments.ends_with(
        r#"--enable-logging --log-file="C:\test profiles\fixture\native-webview2.log""#
    ));
}

#[test]
fn invalid_profiles_cannot_add_browser_switches() {
    for profile in [
        "relative",
        "",
        "C:\\fixture\" --remote-debugging-address=0.0.0.0",
        "C:\\fixture\n",
    ] {
        assert_eq!(
            arguments_for_profile(Some(profile.into()))
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
    }
}
