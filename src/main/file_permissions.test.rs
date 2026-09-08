use super::*;
use crate::files::{FileService, WriteRequest};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
    SetNamedSecurityInfoW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{GetSecurityDescriptorDacl, OWNER_SECURITY_INFORMATION};

fn owner_sid(file: &File) -> String {
    let mut owner = null_mut();
    let mut descriptor = null_mut();

    assert_eq!(
        unsafe {
            GetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut descriptor,
            )
        },
        0
    );

    let mut text = null_mut();

    assert_ne!(unsafe { ConvertSidToStringSidW(owner, &mut text) }, 0);

    let mut length = 0;

    while unsafe { *text.add(length) } != 0 {
        length += 1;
    }

    let result = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) }).unwrap();

    unsafe {
        LocalFree(text.cast());
        LocalFree(descriptor);
    }

    result
}

fn set_dacl(path: &Path, sddl: &str) {
    let text: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let mut descriptor = null_mut();

    assert_ne!(
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                text.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        },
        0
    );

    let mut dacl = null_mut();
    let mut present = 0;
    let mut defaulted = 0;

    assert_ne!(
        unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) },
        0
    );

    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();

    assert_eq!(
        unsafe {
            SetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                dacl,
                null(),
            )
        },
        0
    );

    unsafe {
        LocalFree(descriptor);
    }
}

#[test]
fn replacement_preserves_a_private_dacl_under_a_broader_parent() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("private.txt");

    std::fs::write(&path, b"before").unwrap();

    let owner = owner_sid(&File::open(&path).unwrap());

    set_dacl(
        directory.path(),
        &format!("D:P(A;OICI;FA;;;{owner})(A;OICI;FR;;;BU)"),
    );
    set_dacl(&path, &format!("D:P(A;;FA;;;{owner})"));

    let before = Security::read(&File::open(&path).unwrap()).unwrap();
    let files = FileService::new(directory.path().to_owned()).unwrap();
    let hash = files.read_snapshot(&path).unwrap().unwrap().hash;

    files
        .write(WriteRequest {
            path: path.to_str().unwrap().into(),
            bytes: b"after".to_vec(),
            expected_hash: Some(hash),
        })
        .unwrap();

    let after = Security::read(&File::open(&path).unwrap()).unwrap();

    assert!(before.protected());
    assert!(after.protected());
    assert_eq!(before.dacl_bytes(), after.dacl_bytes());
    assert_eq!(std::fs::read(path).unwrap(), b"after");
}

impl Security {
    fn dacl_bytes(&self) -> Option<Vec<u8>> {
        if self.dacl.is_null() {
            None
        } else {
            Some(
                unsafe {
                    std::slice::from_raw_parts(
                        self.dacl.cast::<u8>(),
                        (*self.dacl).AclSize as usize,
                    )
                }
                .to_vec(),
            )
        }
    }

    fn protected(&self) -> bool {
        self.protected
    }
}
