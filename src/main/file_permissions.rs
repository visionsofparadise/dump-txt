use std::fs::File;
use std::io;
use std::path::Path;

#[cfg(not(windows))]
pub fn preserve(_: &Path, _: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(windows)]
pub fn preserve(path: &Path, temporary: &File) -> io::Result<()> {
    let original = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let permissions = original.metadata()?.permissions();
    if permissions.readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "The file is read-only.",
        ));
    }
    let security = windows::Security::read(&original)?;
    security.apply(temporary)?;
    temporary.set_permissions(permissions)
}

#[cfg(windows)]
#[path = "."]
mod windows {
    use std::fs::File;
    use std::io;
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{LocalFree, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Authorization::{
        GetSecurityInfo, SetSecurityInfo, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorControl, ACL, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
        UNPROTECTED_DACL_SECURITY_INFORMATION,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        ReOpenFile, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, READ_CONTROL, WRITE_DAC,
    };

    pub(super) struct Security {
        descriptor: PSECURITY_DESCRIPTOR,
        dacl: *mut ACL,
        protected: bool,
    }

    impl Security {
        pub(super) fn read(file: &File) -> io::Result<Self> {
            let mut descriptor = null_mut();
            let mut dacl = null_mut();
            let result = unsafe {
                GetSecurityInfo(
                    file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    &mut dacl,
                    null_mut(),
                    &mut descriptor,
                )
            };
            if result != 0 {
                return Err(io::Error::from_raw_os_error(result as i32));
            }
            let mut security = Self {
                descriptor,
                dacl,
                protected: false,
            };
            let mut control = 0;
            let mut revision = 0;
            if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
            {
                return Err(io::Error::last_os_error());
            }
            security.protected = control & SE_DACL_PROTECTED != 0;
            Ok(security)
        }

        pub(super) fn apply(&self, file: &File) -> io::Result<()> {
            let handle = unsafe {
                ReOpenFile(
                    file.as_raw_handle(),
                    WRITE_DAC | READ_CONTROL,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    0,
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    error.kind(),
                    format!("Could not open temporary file permissions: {error}"),
                ));
            }
            let security_file = unsafe { File::from_raw_handle(handle) };
            let inheritance = if self.protected {
                PROTECTED_DACL_SECURITY_INFORMATION
            } else {
                UNPROTECTED_DACL_SECURITY_INFORMATION
            };
            let result = unsafe {
                SetSecurityInfo(
                    security_file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | inheritance,
                    null_mut(),
                    null_mut(),
                    self.dacl,
                    null(),
                )
            };
            if result == 0 {
                Ok(())
            } else {
                let error = io::Error::from_raw_os_error(result as i32);
                Err(io::Error::new(
                    error.kind(),
                    format!("Could not preserve file permissions: {error}"),
                ))
            }
        }
    }

    impl Drop for Security {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.descriptor);
            }
        }
    }

    #[cfg(test)]
    #[path = "file_permissions.test.rs"]
    mod tests;
}
