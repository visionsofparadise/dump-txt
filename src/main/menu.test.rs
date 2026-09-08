use super::*;

fn request(locked: bool) -> MenuRequest {
    MenuRequest {
        can_undo: true,
        can_redo: true,
        has_selection: true,
        locked,
    }
}

fn value(receiver: Receiver<IpcResult<Option<MenuAction>>>) -> serde_json::Value {
    serde_json::to_value(receiver.recv().unwrap()).unwrap()
}

#[test]
fn a_selection_wins_over_later_completion_and_duplicate_events() {
    let state = MenuState::default();
    let (identifier, receiver) = state.begin(request(false)).unwrap();
    state.select(&MenuAction::Copy.identifier(identifier));
    state.select(&MenuAction::Cut.identifier(identifier));
    state.finish(Some(identifier), None, false);
    state.finish(Some(identifier), None, false);
    assert_eq!(
        value(receiver),
        serde_json::json!({"ok": true, "value": "copy"})
    );
    assert!(state.begin(request(false)).is_some());
}

#[test]
fn cancellation_cleans_up_and_stale_events_cannot_choose_the_next_menu() {
    let state = MenuState::default();
    let (previous, receiver) = state.begin(request(false)).unwrap();
    state.finish(None, None, true);
    assert_eq!(
        value(receiver),
        serde_json::json!({"ok": true, "value": null})
    );
    let (current, receiver) = state.begin(request(false)).unwrap();
    state.select(&MenuAction::Paste.identifier(previous));
    state.finish(Some(previous), None, false);
    state.finish(Some(current), None, false);
    assert_eq!(
        value(receiver),
        serde_json::json!({"ok": true, "value": null})
    );
}

#[test]
fn locked_menus_accept_copy_and_select_all_while_rejecting_mutation() {
    let state = MenuState::default();
    let (identifier, receiver) = state.begin(request(true)).unwrap();
    for action in [
        MenuAction::Cut,
        MenuAction::Paste,
        MenuAction::Delete,
        MenuAction::Undo,
        MenuAction::Redo,
    ] {
        state.select(&action.identifier(identifier));
    }
    state.select(&MenuAction::SelectAll.identifier(identifier));
    state.finish(Some(identifier), None, false);
    assert_eq!(
        value(receiver),
        serde_json::json!({"ok": true, "value": "selectAll"})
    );
    let (identifier, receiver) = state.begin(request(true)).unwrap();
    state.select(&MenuAction::Copy.identifier(identifier));
    state.finish(Some(identifier), None, false);
    assert_eq!(
        value(receiver),
        serde_json::json!({"ok": true, "value": "copy"})
    );
}

#[test]
fn popup_failure_settles_once_and_allows_retry() {
    let state = MenuState::default();
    let (identifier, receiver) = state.begin(request(false)).unwrap();
    assert!(state.begin(request(false)).is_none());
    state.finish(Some(identifier), Some("Popup failed".into()), false);
    assert_eq!(
        value(receiver),
        serde_json::json!({"ok": false, "error": {"code": "io", "message": "Popup failed"}})
    );
    assert!(state.begin(request(false)).is_some());
}
