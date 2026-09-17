use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_documents);

struct Documents<R: Runtime>(PluginHandle<R>);

#[derive(Clone, Debug, Deserialize)]
pub struct NativeDocument {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOptions {
    pub title: Option<String>,
    pub file_name: Option<String>,
    pub extensions: Vec<String>,
    pub writable: bool,
}

#[derive(Deserialize)]
struct DocumentResponse {
    document: Option<NativeDocument>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("documents")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle =
                api.register_android_plugin("com.visionsofparadise.dump_txt", "DocumentsPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_documents)?;

            app.manage(Documents(handle));

            Ok(())
        })
        .build()
}

pub async fn pick_document(
    app: &AppHandle,
    options: DocumentOptions,
    save: bool,
) -> Result<Option<NativeDocument>, PluginInvokeError> {
    let documents = app.state::<Documents<tauri::Wry>>();
    let command = if save {
        "createDocument"
    } else {
        "openDocument"
    };
    let response: DocumentResponse = documents
        .0
        .run_mobile_plugin_async(command, options)
        .await?;

    Ok(response.document)
}

pub fn resolve_document(
    app: &AppHandle,
    path: &str,
    writable: bool,
) -> Result<Option<NativeDocument>, PluginInvokeError> {
    let response: DocumentResponse = app.state::<Documents<tauri::Wry>>().0.run_mobile_plugin(
        "resolveDocument",
        serde_json::json!({ "path": path, "writable": writable }),
    )?;

    Ok(response.document)
}

#[cfg(target_os = "ios")]
pub fn release_document(app: &AppHandle, path: &str) -> Result<(), PluginInvokeError> {
    app.state::<Documents<tauri::Wry>>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "releaseDocument",
            serde_json::json!({ "path": path }),
        )
        .map(|_| ())
}
