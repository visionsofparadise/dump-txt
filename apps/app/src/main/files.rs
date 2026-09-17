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
    path: PathBuf,
    request: WriteRequest,
    ticket: WriteTicket,
}

pub struct FileService {
    user_data: PathBuf,
    grants: Mutex<HashSet<PathBuf>>,
    queues: Mutex<HashMap<PathBuf, Weak<WriteQueue>>>,
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
        })
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
            .insert(comparison_path(&canonical));

        Ok(canonical)
    }

    fn authorize_path(&self, path: &Path) -> Result<PathBuf, IpcFailure> {
        let canonical = canonical_path(path)?;
        let key = comparison_path(&canonical);
        let root = comparison_path(&canonical_path(&self.user_data)?);

        if key.starts_with(&root) || self.grants.lock().map_err(lock_failure)?.contains(&key) {
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

        let path = self.authorize_path(Path::new(&request.path))?;
        let key = comparison_path(&path);
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

        let path = self.authorize_path(Path::new(&prepared.request.path))?;

        if comparison_path(&path) != comparison_path(&prepared.path) {
            return Err(failure(
                "permission",
                "The file destination changed while waiting to save.",
            ));
        }

        let actual_hash = read_exact_snapshot(&path)?.map(|snapshot| snapshot.hash);

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

        let mut file = AtomicWriteFile::open(&path)?;

        crate::file_permissions::preserve(&path, file.as_file())?;
        file.write_all(&prepared.request.bytes)?;
        file.commit()?;

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
        files.read_snapshot(Path::new(&request.path))
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
