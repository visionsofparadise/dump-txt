#![cfg(all(feature = "automation", target_os = "windows"))]

use std::{ffi::OsString, io, path::PathBuf};

fn arguments_for_profile(profile: Option<OsString>) -> io::Result<Option<String>> {
    let Some(profile) = profile else {
        return Ok(None);
    };
    let profile = PathBuf::from(profile);

    if !profile.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "The automation webview profile must be an absolute path.",
        ));
    }

    let log_path = profile.join("native-webview2.log");
    let log_path = log_path
        .to_str()
        .filter(|value| !value.contains(['\0', '\r', '\n', '"']))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "The automation webview log path cannot be represented safely.",
            )
        })?;

    Ok(Some(format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --enable-logging --log-file=\"{log_path}\""
    )))
}

pub fn browser_arguments() -> io::Result<Option<String>> {
    arguments_for_profile(std::env::var_os("TAURI_TEST_WEBVIEW_DATA_FOLDER"))
}

#[cfg(test)]
#[path = "automation.test.rs"]
mod tests;
