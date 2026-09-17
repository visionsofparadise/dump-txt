use crate::document::DocumentRef;
use crate::error::{parse_request, IpcFailure, IpcResult};
use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, Weak};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct FileRead {
    pub bytes: Vec<u8>,
    pub hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteRequest {
    pub path: String,
    pub bytes: Vec<u8>,
    #[serde(deserialize_with = "required_hash")]
    pub expected_hash: Option<String>,
}

fn required_hash<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[derive(Debug, Serialize)]
pub struct WriteResult {
    pub hash: String,
}

#[derive(Default)]
struct QueueState {
    next: u64,
    current: u64,
    completed: HashSet<u64>,
}

#[derive(Default)]
struct WriteQueue {
    state: Mutex<QueueState>,
    changed: Condvar,
}

struct WriteTicket {
    queue: Arc<WriteQueue>,
    number: u64,
}

impl WriteTicket {
    fn wait(&self) -> Result<(), IpcFailure> {
        let mut state = self.queue.state.lock().map_err(lock_failure)?;

        while state.current != self.number {
            state = self.queue.changed.wait(state).map_err(lock_failure)?;
        }

        Ok(())
    }
}

impl Drop for WriteTicket {
    fn drop(&mut self) {
        let mut state = self
            .queue
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        state.completed.insert(self.number);

        loop {
            let current = state.current;

            if !state.completed.remove(&current) {
                break;
            }

            state.current += 1;
        }

        self.queue.changed.notify_all();
    }
}

struct PreparedWrite {
    path: DocumentRef,
    request: WriteRequest,
    ticket: WriteTicket,
}

pub struct FileService {
    user_data: PathBuf,
    grants: Mutex<HashSet<DocumentRef>>,
    queues: Mutex<HashMap<DocumentRef, Weak<WriteQueue>>>,
    #[cfg(mobile)]
    app: Option<tauri::AppHandle>,
}

fn failure(code: &'static str, message: &str) -> IpcFailure {
    IpcFailure {
        code,
        message: message.into(),
    }
}

fn lock_failure<T>(_: std::sync::PoisonError<T>) -> IpcFailure {
    failure(
        "io",
        "The file service could not complete the requested action.",
    )
}

fn absolute_path(path: &Path) -> Result<PathBuf, IpcFailure> {
    if !path.is_absolute() || path.as_os_str().to_string_lossy().contains('\0') {
        return Err(failure("invalid", "A full file path is required."));
    }

    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }

    Ok(normalized)
}

pub fn canonical_path(path: &Path) -> Result<PathBuf, IpcFailure> {
    let resolved = absolute_path(path)?;

    match dunce::canonicalize(&resolved) {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match fs::symlink_metadata(&resolved) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(failure(
                        "permission",
                        "The file points to an unavailable symbolic-link destination.",
                    ))
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }

            let Some(parent) = resolved.parent() else {
                return Err(error.into());
            };
            let Some(name) = resolved.file_name() else {
                return Err(error.into());
            };

            Ok(canonical_path(parent)?.join(name))
        }
        Err(error) => Err(error.into()),
    }
}

pub fn renderer_path(path: &Path) -> Result<String, IpcFailure> {
    path.to_str()
        .map(String::from)
        .ok_or_else(|| failure("invalid", "The file path cannot be represented as text."))
}

fn comparison_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(path.as_os_str().to_string_lossy().to_lowercase())
    }

    #[cfg(not(windows))]
    {
        path.to_owned()
    }
}

fn comparison_document(document: &DocumentRef) -> DocumentRef {
    match document {
        DocumentRef::Path(path) => DocumentRef::Path(comparison_path(path)),
        DocumentRef::Uri(_) => document.clone(),
    }
}

fn hash_of(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_exact_snapshot(path: &Path) -> Result<Option<FileRead>, IpcFailure> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(FileRead {
            hash: hash_of(&bytes),
            bytes,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

impl FileService {
    pub fn new(user_data: PathBuf) -> Result<Self, IpcFailure> {
        let user_data = absolute_path(&user_data)?;

        fs::create_dir_all(&user_data)?;

        Ok(Self {
            user_data: canonical_path(&user_data)?,
            grants: Mutex::new(HashSet::new()),
            queues: Mutex::new(HashMap::new()),
            #[cfg(mobile)]
            app: None,
        })
    }

    #[cfg(mobile)]
    pub fn with_app(mut self, app: tauri::AppHandle) -> Self {
        self.app = Some(app);

        self
    }

    pub fn user_data(&self) -> &Path {
        &self.user_data
    }

    pub fn grant_path(&self, path: &Path, allow_unavailable: bool) -> Result<PathBuf, IpcFailure> {
        let resolved = absolute_path(path)?;
        let canonical = match canonical_path(&resolved) {
            Ok(path) => path,
            Err(_) if allow_unavailable => resolved,
            Err(error) => return Err(error),
        };

        self.grants
            .lock()
            .map_err(lock_failure)?
            .insert(DocumentRef::Path(comparison_path(&canonical)));

        Ok(canonical)
    }

    fn authorize_path(&self, path: &Path) -> Result<PathBuf, IpcFailure> {
        let canonical = canonical_path(path)?;
        let key = comparison_path(&canonical);
        let root = comparison_path(&canonical_path(&self.user_data)?);

        if key.starts_with(&root)
            || self
                .grants
                .lock()
                .map_err(lock_failure)?
                .contains(&DocumentRef::Path(key.clone()))
        {
            Ok(canonical)
        } else {
            Err(failure(
                "permission",
                "Open or choose this file with the file menu before accessing it.",
            ))
        }
    }

    pub fn read_snapshot(&self, path: &Path) -> Result<Option<FileRead>, IpcFailure> {
        read_exact_snapshot(&self.authorize_path(path)?)
    }

    pub fn grant_document(
        &self,
        document: &DocumentRef,
        allow_unavailable: bool,
    ) -> Result<DocumentRef, IpcFailure> {
        match document {
            DocumentRef::Path(path) => self
                .grant_path(path, allow_unavailable)
                .map(DocumentRef::Path),
            DocumentRef::Uri(url) => {
                if !matches!(url.scheme(), "content" | "file") {
                    return Err(failure("invalid", "The document URI is unsupported."));
                }

                self.grants
                    .lock()
                    .map_err(lock_failure)?
                    .insert(document.clone());

                Ok(document.clone())
            }
        }
    }

    fn authorize_document(&self, document: &DocumentRef) -> Result<DocumentRef, IpcFailure> {
        match document {
            DocumentRef::Path(path) => self.authorize_path(path).map(DocumentRef::Path),
            DocumentRef::Uri(_) if self.grants.lock().map_err(lock_failure)?.contains(document) => {
                Ok(document.clone())
            }
            DocumentRef::Uri(_) => Err(failure(
                "permission",
                "Open or choose this file with the file menu before accessing it.",
            )),
        }
    }

    pub fn read_document(&self, document: &DocumentRef) -> Result<Option<FileRead>, IpcFailure> {
        let document = self.authorize_document(document)?;

        match &document {
            DocumentRef::Path(path) => read_exact_snapshot(path),
            DocumentRef::Uri(url) => self.read_uri(url),
        }
    }

    #[cfg(desktop)]
    fn read_uri(&self, _: &tauri::Url) -> Result<Option<FileRead>, IpcFailure> {
        Err(failure(
            "invalid",
            "External document URIs require a mobile host.",
        ))
    }

    #[cfg(desktop)]
    fn write_uri(&self, _: &tauri::Url, _: &[u8]) -> Result<(), IpcFailure> {
        Err(failure(
            "invalid",
            "External document URIs require a mobile host.",
        ))
    }

    fn prepare_write(&self, request: WriteRequest) -> Result<PreparedWrite, IpcFailure> {
        if request.expected_hash.as_ref().is_some_and(|hash| {
            hash.len() != 64
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }) {
            return Err(failure(
                "invalid",
                "The requested action contains invalid values.",
            ));
        }

        let path = self.authorize_document(&DocumentRef::parse(&request.path)?)?;
        let key = comparison_document(&path);
        let mut queues = self.queues.lock().map_err(lock_failure)?;

        queues.retain(|_, queue| queue.strong_count() != 0);

        let queue = queues.get(&key).and_then(Weak::upgrade).unwrap_or_else(|| {
            let queue = Arc::new(WriteQueue::default());

            queues.insert(key, Arc::downgrade(&queue));

            queue
        });
        let mut state = queue.state.lock().map_err(lock_failure)?;
        let number = state.next;
        state.next += 1;

        drop(state);

        Ok(PreparedWrite {
            path,
            request,
            ticket: WriteTicket { queue, number },
        })
    }

    fn complete_write(&self, prepared: PreparedWrite) -> Result<WriteResult, IpcFailure> {
        prepared.ticket.wait()?;

        let path = self.authorize_document(&DocumentRef::parse(&prepared.request.path)?)?;

        if comparison_document(&path) != comparison_document(&prepared.path) {
            return Err(failure(
                "permission",
                "The file destination changed while waiting to save.",
            ));
        }

        let actual_hash = self.read_document(&path)?.map(|snapshot| snapshot.hash);

        if actual_hash != prepared.request.expected_hash {
            return Err(if actual_hash.is_none() {
                failure(
                    "missing",
                    "The file is missing. Use Save As to choose a location.",
                )
            } else {
                failure(
                    "conflict",
                    "The file changed outside dump.txt. Use Save As to preserve this text.",
                )
            });
        }

        match &path {
            DocumentRef::Path(path) => {
                let mut file = AtomicWriteFile::open(path)?;

                crate::file_permissions::preserve(path, file.as_file())?;
                file.write_all(&prepared.request.bytes)?;
                file.commit()?;
            }
            DocumentRef::Uri(url) => self.write_uri(url, &prepared.request.bytes)?,
        }

        Ok(WriteResult {
            hash: hash_of(&prepared.request.bytes),
        })
    }

    #[cfg(test)]
    pub fn write(&self, request: WriteRequest) -> Result<WriteResult, IpcFailure> {
        self.complete_write(self.prepare_write(request)?)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadRequest {
    path: String,
}

#[tauri::command]
pub async fn read_file(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> IpcResult<Option<FileRead>> {
    let request = match parse_request::<ReadRequest>(request) {
        Ok(request) => request,
        Err(error) => return IpcResult::Failure { ok: false, error },
    };
    let files = Arc::clone(app.state::<Arc<FileService>>().inner());

    match tauri::async_runtime::spawn_blocking(move || {
        files.read_document(&DocumentRef::parse(&request.path)?)
    })
    .await
    {
        Ok(result) => IpcResult::from_ipc_result(result),
        Err(error) => IpcResult::failure("io", error.to_string()),
    }
}

#[tauri::command]
pub async fn write_file(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> IpcResult<WriteResult> {
    let files = Arc::clone(app.state::<Arc<FileService>>().inner());
    let prepared = match parse_request::<WriteRequest>(request)
        .and_then(|request| files.prepare_write(request))
    {
        Ok(prepared) => prepared,
        Err(error) => return IpcResult::Failure { ok: false, error },
    };

    match tauri::async_runtime::spawn_blocking(move || files.complete_write(prepared)).await {
        Ok(result) => IpcResult::from_ipc_result(result),
        Err(error) => IpcResult::failure("io", error.to_string()),
    }
}

#[cfg(test)]
#[path = "files.test.rs"]
mod tests;

#[cfg(mobile)]
impl FileService {
    fn mobile_app(&self) -> Result<&tauri::AppHandle, IpcFailure> {
        self.app
            .as_ref()
            .ok_or_else(|| failure("io", "The mobile document service is unavailable."))
    }

    fn read_uri(&self, url: &tauri::Url) -> Result<Option<FileRead>, IpcFailure> {
        use std::io::Read;

        let app = self.mobile_app()?;
        let Some(document) = tauri_plugin_documents::resolve_document(app, url.as_str(), false)?
        else {
            return Ok(None);
        };
        let options = tauri_plugin_fs::OpenOptions::new().read(true).clone();
        let result = with_uri_file(app, &document.path, options, |file| {
            let mut bytes = Vec::new();

            file.read_to_end(&mut bytes)?;

            Ok(FileRead {
                hash: hash_of(&bytes),
                bytes,
            })
        });

        match result {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(error) if error.code == "missing" => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn write_uri(&self, url: &tauri::Url, bytes: &[u8]) -> Result<(), IpcFailure> {
        let app = self.mobile_app()?;
        let document = tauri_plugin_documents::resolve_document(app, url.as_str(), true)?
            .ok_or_else(|| {
                failure(
                    "missing",
                    "The document is unavailable. Use Save As to choose a location.",
                )
            })?;
        let options = tauri_plugin_fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .clone();

        with_uri_file(app, &document.path, options, |file| {
            file.write_all(bytes)?;

            sync_document(file)
        })
    }
}

#[cfg(any(mobile, all(test, unix)))]
fn sync_document(file: &fs::File) -> std::io::Result<()> {
    if file.metadata()?.is_file() {
        file.sync_all()?;
    }

    Ok(())
}

#[cfg(mobile)]
fn with_uri_file<T>(
    app: &tauri::AppHandle,
    reference: &str,
    options: tauri_plugin_fs::OpenOptions,
    action: impl FnOnce(&mut fs::File) -> std::io::Result<T>,
) -> Result<T, IpcFailure> {
    #[cfg(target_os = "android")]
    use tauri_plugin_fs::FsExt;

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let url = tauri::Url::parse(reference)
            .map_err(|_| failure("invalid", "The native document URI is invalid."))?;

        #[cfg(target_os = "android")]
        if url.scheme() != "content" {
            return Err(failure(
                "invalid",
                "Android documents require a content URI.",
            ));
        }

        #[cfg(target_os = "ios")]
        if url.scheme() != "file" {
            return Err(failure("invalid", "iOS documents require a file URI."));
        }

        #[cfg(target_os = "android")]
        let mut file = app
            .fs()
            .open(tauri_plugin_fs::FilePath::Url(url), options)?;
        #[cfg(target_os = "ios")]
        let mut file = std::fs::OpenOptions::from(options).open(
            url.to_file_path()
                .map_err(|_| failure("invalid", "The native document URI is invalid."))?,
        )?;

        action(&mut file).map_err(IpcFailure::from)
    }));
    #[cfg(target_os = "ios")]
    let released = tauri_plugin_documents::release_document(app, reference);
    let value = result.map_err(|_| {
        failure(
            "missing",
            "The document is unavailable. Use Save As to choose a location.",
        )
    })??;

    #[cfg(target_os = "ios")]
    released?;

    Ok(value)
}
