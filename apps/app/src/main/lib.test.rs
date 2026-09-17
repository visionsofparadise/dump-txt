use super::*;

#[test]
fn production_navigation_stays_on_the_bundled_entry() {
    assert!(navigation_allowed(
        &"tauri://localhost".parse().unwrap(),
        None
    ));
    assert!(navigation_allowed(
        &"tauri://localhost/probe.html".parse().unwrap(),
        None
    ));
    assert!(navigation_allowed(
        &"http://tauri.localhost/index.html".parse().unwrap(),
        None
    ));

    for url in [
        "tauri://localhost?unexpected=entry",
        "tauri://localhost:8080",
        "https://example.com",
        "file:///etc/passwd",
        "http://localhost:1420/probe.html",
        "tauri://localhost/other.html",
    ] {
        assert!(!navigation_allowed(&url.parse().unwrap(), None), "{url}");
    }
}

#[test]
fn development_navigation_requires_the_exact_server_origin() {
    let origin = "http://localhost:1420".parse().unwrap();

    assert!(navigation_allowed(
        &"http://localhost:1420/probe.html".parse().unwrap(),
        Some(&origin)
    ));
    assert!(!navigation_allowed(
        &"http://localhost:9999/probe.html".parse().unwrap(),
        Some(&origin)
    ));
}
