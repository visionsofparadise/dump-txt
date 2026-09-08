use super::*;
use serde_json::json;
use std::sync::Barrier;

fn request(path: &Path, bytes: &[u8], expected_hash: Option<String>) -> WriteRequest {
    WriteRequest {
        path: renderer_path(path).unwrap(),
        bytes: bytes.to_vec(),
        expected_hash,
    }
}

#[test]
fn snapshots_and_writes_preserve_exact_bytes_and_hashes() {
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let path = directory.path().join("Café 中文.txt");
    assert!(files.read_snapshot(&path).unwrap().is_none());
    let mut hash = None;
    for bytes in [
        Vec::new(),
        "Café\r\n中文 · 👩‍💻\n\u{c}\n".as_bytes().to_vec(),
        vec![0xef, 0xbb, 0xbf, b'a', b'\r', b'\n'],
        vec![0xff, 0xfe, b'A', 0, 0x3d, 0xd8, 0x00, 0xde],
        vec![0xfe, 0xff, 0, b'A', 0xd8, 0x3d, 0xde, 0x00],
    ] {
        let result = files.write(request(&path, &bytes, hash)).unwrap();
        let snapshot = files.read_snapshot(&path).unwrap().unwrap();
        assert_eq!(snapshot.bytes, bytes);
        assert_eq!(snapshot.hash, hash_of(&bytes));
        assert_eq!(result.hash, snapshot.hash);
        hash = Some(result.hash);
    }
    assert_eq!(
        hash_of(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn conflicts_and_missing_files_leave_disk_bytes_untouched() {
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let path = directory.path().join("dump.txt");
    let hash = files.write(request(&path, b"initial", None)).unwrap().hash;
    fs::write(&path, b"external").unwrap();
    let error = files
        .write(request(&path, b"ours", Some(hash.clone())))
        .unwrap_err();
    assert_eq!(error.code, "conflict");
    assert_eq!(fs::read(&path).unwrap(), b"external");
    assert_eq!(
        files.write(request(&path, b"ours", None)).unwrap_err().code,
        "conflict"
    );
    fs::remove_file(&path).unwrap();
    assert_eq!(
        files
            .write(request(&path, b"ours", Some(hash)))
            .unwrap_err()
            .code,
        "missing"
    );
    assert!(!path.exists());
}

#[test]
fn authorization_requires_owned_paths_or_exact_grants() {
    let directory = tempfile::tempdir().unwrap();
    let owned = directory.path().join("profile");
    let files = FileService::new(owned.clone()).unwrap();
    for path in [
        directory.path().join("external.txt"),
        directory.path().join("profile-other/file.txt"),
        owned.join("../escape.txt"),
    ] {
        assert_eq!(files.read_snapshot(&path).unwrap_err().code, "permission");
        assert_eq!(
            files.write(request(&path, b"text", None)).unwrap_err().code,
            "permission"
        );
    }
    for path in [PathBuf::from("relative.txt"), owned.join("invalid\0.txt")] {
        assert_eq!(files.read_snapshot(&path).unwrap_err().code, "invalid");
        assert_eq!(files.grant_path(&path, true).unwrap_err().code, "invalid");
    }
    let external = directory.path().join("external.txt");
    assert_eq!(
        files.grant_path(&external, false).unwrap(),
        canonical_path(&external).unwrap()
    );
    files.write(request(&external, b"granted", None)).unwrap();
    assert_eq!(
        files.read_snapshot(&external).unwrap().unwrap().bytes,
        b"granted"
    );
    assert_eq!(
        files
            .read_snapshot(&directory.path().join("other.txt"))
            .unwrap_err()
            .code,
        "permission"
    );
}

#[test]
fn missing_parents_are_canonicalized_without_creating_backing_directories() {
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let path = directory.path().join("missing/nested/dump.txt");
    assert!(files.read_snapshot(&path).unwrap().is_none());
    assert_eq!(
        files.write(request(&path, b"text", None)).unwrap_err().code,
        "missing"
    );
    assert!(!directory.path().join("missing").exists());
}

#[test]
fn malformed_requests_preserve_the_invalid_error_envelope() {
    for value in [
        json!({"path": "/file", "bytes": []}),
        json!({"path": "/file", "bytes": [-1], "expectedHash": null}),
        json!({"path": "/file", "bytes": [256], "expectedHash": null}),
        json!({"path": "/file", "bytes": [1.5], "expectedHash": null}),
        json!({"path": "/file", "bytes": [], "expectedHash": null, "other": true}),
    ] {
        let result = IpcResult::from_ipc_result(parse_request::<WriteRequest>(value));
        match result {
            IpcResult::Failure { ok, error } => {
                assert!(!ok);
                assert_eq!(error.code, "invalid");
            }
            _ => panic!("malformed request was accepted"),
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    for hash in ["ABCDEF".repeat(11), "g".repeat(64), "0".repeat(63)] {
        assert_eq!(
            files
                .write(request(
                    &directory.path().join("dump.txt"),
                    b"x",
                    Some(hash)
                ))
                .unwrap_err()
                .code,
            "invalid"
        );
    }
}

#[test]
fn concurrent_own_writes_compare_inside_the_same_critical_section() {
    let directory = tempfile::tempdir().unwrap();
    let files = Arc::new(FileService::new(directory.path().to_owned()).unwrap());
    let path = directory.path().join("dump.txt");
    let hash = files.write(request(&path, b"initial", None)).unwrap().hash;
    let barrier = Arc::new(Barrier::new(3));
    let threads: Vec<_> = [b"first".as_slice(), b"second".as_slice()]
        .into_iter()
        .map(|bytes| {
            let files = Arc::clone(&files);
            let barrier = Arc::clone(&barrier);
            let request = request(&path, bytes, Some(hash.clone()));
            std::thread::spawn(move || {
                barrier.wait();
                files.write(request)
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| result.as_ref().is_err_and(|error| error.code == "conflict"))
            .count(),
        1
    );
    assert_eq!(
        files.read_snapshot(&path).unwrap().unwrap().hash,
        results.into_iter().find_map(Result::ok).unwrap().hash
    );
}

#[test]
fn queued_writes_keep_registration_order_and_skipped_jobs_do_not_deadlock() {
    let directory = tempfile::tempdir().unwrap();
    let files = Arc::new(FileService::new(directory.path().to_owned()).unwrap());
    let path = directory.path().join("dump.txt");
    let first = files.prepare_write(request(&path, b"first", None)).unwrap();
    let skipped = files
        .prepare_write(request(&path, b"skipped", None))
        .unwrap();
    let last = files
        .prepare_write(request(&path, b"last", Some(hash_of(b"first"))))
        .unwrap();
    let worker_files = Arc::clone(&files);
    let worker = std::thread::spawn(move || worker_files.complete_write(last));
    drop(skipped);
    files.complete_write(first).unwrap();
    worker.join().unwrap().unwrap();
    assert_eq!(fs::read(path).unwrap(), b"last");
}

#[test]
fn abandoned_partial_replacement_keeps_original_content() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("dump.txt");
    fs::write(&path, b"original").unwrap();
    {
        let mut file = AtomicWriteFile::open(&path).unwrap();
        crate::file_permissions::preserve(&path, file.as_file()).unwrap();
        file.write_all(b"partial replacement").unwrap();
        file.sync_all().unwrap();
    }
    assert_eq!(fs::read(&path).unwrap(), b"original");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn symlinks_preserve_the_granted_target_and_cannot_escape_the_profile() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("profile");
    let files = FileService::new(root.clone()).unwrap();
    let external = directory.path().join("external.txt");
    fs::write(&external, b"original").unwrap();
    let link = root.join("link.txt");
    symlink(&external, &link).unwrap();
    assert_eq!(files.read_snapshot(&link).unwrap_err().code, "permission");
    files.grant_path(&link, false).unwrap();
    files
        .write(request(&link, b"saved", Some(hash_of(b"original"))))
        .unwrap();
    assert!(fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read(&external).unwrap(), b"saved");
    let dangling = root.join("dangling.txt");
    symlink(directory.path().join("missing.txt"), &dangling).unwrap();
    assert_eq!(
        files.read_snapshot(&dangling).unwrap_err().code,
        "permission"
    );
    assert_eq!(
        files.grant_path(&dangling, false).unwrap_err().code,
        "permission"
    );
    assert!(files.grant_path(&dangling, true).is_ok());
    assert_eq!(
        files.read_snapshot(&dangling).unwrap_err().code,
        "permission"
    );
    let escape = root.join("outside");
    symlink(directory.path(), &escape).unwrap();
    assert_eq!(
        files
            .write(request(&escape.join("new.txt"), b"x", None))
            .unwrap_err()
            .code,
        "permission"
    );
}

#[cfg(unix)]
#[test]
fn replacement_preserves_unix_mode() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let path = directory.path().join("private.txt");
    fs::write(&path, b"before").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    files
        .write(request(&path, b"after", Some(hash_of(b"before"))))
        .unwrap();
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[cfg(windows)]
#[test]
fn readonly_files_are_denied_without_changing_content() {
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let path = directory.path().join("readonly.txt");
    fs::write(&path, b"before").unwrap();
    let original = fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    let result = files.write(request(&path, b"after", Some(hash_of(b"before"))));
    fs::set_permissions(&path, original).unwrap();
    assert_eq!(result.unwrap_err().code, "permission");
    assert_eq!(fs::read(path).unwrap(), b"before");
}

#[cfg(windows)]
#[test]
fn canonical_paths_preserve_renderer_compatible_windows_paths() {
    let directory = tempfile::tempdir().unwrap();
    let plain = canonical_path(directory.path()).unwrap();
    assert!(!renderer_path(&plain).unwrap().starts_with("\\\\?\\"));
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let path = directory.path().join("mixed.txt");
    files.write(request(&path, b"text", None)).unwrap();
    let upper = PathBuf::from(renderer_path(&path).unwrap().to_uppercase());
    assert_eq!(files.read_snapshot(&upper).unwrap().unwrap().bytes, b"text");
}
