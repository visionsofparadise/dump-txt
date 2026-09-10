use crate::error::{parse_request, EmptyRequest, IpcResult};
use font_kit::source::SystemSource;

#[tauri::command]
pub async fn get_system_fonts(request: serde_json::Value) -> IpcResult<Vec<String>> {
    if let Err(error) = parse_request::<EmptyRequest>(request) {
        return IpcResult::Failure { ok: false, error };
    }

    IpcResult::from_join_result(
        tauri::async_runtime::spawn_blocking(|| {
            SystemSource::new().all_families().map(|families| {
                families
                    .into_iter()
                    .filter(|family| !family.is_empty())
                    .collect()
            })
        })
        .await,
    )
}

#[cfg(test)]
#[path = "fonts.test.rs"]
mod tests;
