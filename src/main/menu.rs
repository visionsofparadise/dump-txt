use crate::error::{parse_request, IpcResult};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{sync_channel, Receiver, SyncSender},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    AppHandle, Manager, WebviewWindow, WindowEvent,
};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MenuAction {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    Delete,
    SelectAll,
}

const ACTIONS: [MenuAction; 7] = [
    MenuAction::Undo,
    MenuAction::Redo,
    MenuAction::Cut,
    MenuAction::Copy,
    MenuAction::Paste,
    MenuAction::Delete,
    MenuAction::SelectAll,
];

impl MenuAction {
    fn label(self) -> &'static str {
        match self {
            Self::Undo => "Undo",
            Self::Redo => "Redo",
            Self::Cut => "Cut",
            Self::Copy => "Copy",
            Self::Paste => "Paste",
            Self::Delete => "Delete",
            Self::SelectAll => "Select All",
        }
    }

    fn identifier(self, invocation: u64) -> String {
        format!("editing-{invocation}-{}", self.label())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MenuRequest {
    can_undo: bool,
    can_redo: bool,
    has_selection: bool,
    locked: bool,
}

impl MenuRequest {
    fn enabled(&self, action: MenuAction) -> bool {
        match action {
            MenuAction::Undo => self.can_undo && !self.locked,
            MenuAction::Redo => self.can_redo && !self.locked,
            MenuAction::Cut | MenuAction::Delete => self.has_selection && !self.locked,
            MenuAction::Copy => self.has_selection,
            MenuAction::Paste => !self.locked,
            MenuAction::SelectAll => true,
        }
    }
}

struct Invocation {
    identifier: u64,
    request: MenuRequest,
    selection: Option<MenuAction>,
    response: SyncSender<IpcResult<Option<MenuAction>>>,
}

#[derive(Default)]
pub struct MenuState {
    next_identifier: AtomicU64,
    invocation: Mutex<Option<Invocation>>,
}

impl MenuState {
    fn begin(
        &self,
        request: MenuRequest,
    ) -> Option<(u64, Receiver<IpcResult<Option<MenuAction>>>)> {
        let mut active = self
            .invocation
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active.is_some() {
            return None;
        }
        let identifier = self.next_identifier.fetch_add(1, Ordering::Relaxed);
        let (response, receiver) = sync_channel(1);
        *active = Some(Invocation {
            identifier,
            request,
            selection: None,
            response,
        });
        Some((identifier, receiver))
    }

    fn select(&self, menu_identifier: &str) {
        let mut active = self
            .invocation
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(invocation) = active.as_mut() {
            if invocation.selection.is_some() {
                return;
            }
            invocation.selection = ACTIONS.into_iter().find(|action| {
                invocation.request.enabled(*action)
                    && action.identifier(invocation.identifier) == menu_identifier
            });
        }
    }

    fn finish(&self, identifier: Option<u64>, failure: Option<String>, cancel: bool) {
        let mut active = self
            .invocation
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !active.as_ref().is_some_and(|invocation| {
            identifier.is_none_or(|identifier| identifier == invocation.identifier)
        }) {
            return;
        }
        if let Some(invocation) = active.take() {
            let result = match failure {
                Some(message) => IpcResult::failure("io", message),
                None => IpcResult::Success {
                    ok: true,
                    value: if cancel { None } else { invocation.selection },
                },
            };
            let _ = invocation.response.try_send(result);
        }
    }
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    app.state::<MenuState>().select(event.id.as_ref());
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Destroyed) {
        window.state::<MenuState>().finish(None, None, true);
    }
}

fn create_menu(app: &AppHandle, identifier: u64) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let state = app.state::<MenuState>();
    let enabled: Vec<bool> = {
        let active = state
            .invocation
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        ACTIONS
            .iter()
            .map(|action| {
                active.as_ref().is_some_and(|invocation| {
                    invocation.identifier == identifier && invocation.request.enabled(*action)
                })
            })
            .collect()
    };
    for (action, enabled) in ACTIONS.into_iter().zip(enabled) {
        if matches!(action, MenuAction::Cut | MenuAction::SelectAll) {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        menu.append(&MenuItem::with_id(
            app,
            action.identifier(identifier),
            action.label(),
            enabled,
            None::<&str>,
        )?)?;
    }
    Ok(menu)
}

#[tauri::command]
pub async fn show_text_context_menu(
    window: WebviewWindow,
    request: serde_json::Value,
) -> IpcResult<Option<MenuAction>> {
    let request = match parse_request::<MenuRequest>(request) {
        Ok(request) => request,
        Err(error) => return IpcResult::Failure { ok: false, error },
    };
    let app = window.app_handle().clone();
    let Some((identifier, receiver)) = app.state::<MenuState>().begin(request) else {
        return IpcResult::Success {
            ok: true,
            value: None,
        };
    };
    let failed_app = app.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        let shown = create_menu(&app, identifier).and_then(|menu| window.popup_menu(&menu));
        let completed_app = app.clone();
        let queued = app.run_on_main_thread(move || {
            completed_app.state::<MenuState>().finish(
                Some(identifier),
                shown.err().map(|error| error.to_string()),
                false,
            );
        });
        if let Err(error) = queued {
            app.state::<MenuState>()
                .finish(Some(identifier), Some(error.to_string()), false);
        }
        receiver.recv().unwrap_or_else(|_| {
            IpcResult::failure("io", "The editing menu closed without a response.")
        })
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            let message = error.to_string();
            failed_app
                .state::<MenuState>()
                .finish(Some(identifier), Some(message.clone()), false);
            IpcResult::failure("io", message)
        }
    }
}

#[cfg(test)]
#[path = "menu.test.rs"]
mod tests;
