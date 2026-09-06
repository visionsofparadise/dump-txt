use crate::error::{parse_request, EmptyRequest, IpcResult};
use font_kit::source::SystemSource;

#[tauri::command]
pub async fn get_system_fonts(request: serde_json::Value) -> IpcResult<Vec<String>> {
    if let Err(error) = parse_request::<EmptyRequest>(request) {
        return IpcResult::Failure { ok: false, error };
    }
    match tauri::async_runtime::spawn_blocking(|| {
        SystemSource::new().all_families().map(|families| {
            families
                .into_iter()
                .filter(|family| !family.is_empty())
                .collect()
        })
    })
    .await
    {
        Ok(result) => IpcResult::from_result(result),
        Err(error) => IpcResult::failure("io", error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_system_source_returns_installed_family_names() {
        let families = SystemSource::new().all_families().unwrap();
        assert!(!families.is_empty());
        assert!(families.iter().all(|family| !family.is_empty()));
    }
}
