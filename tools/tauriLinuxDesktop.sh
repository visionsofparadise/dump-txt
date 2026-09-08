#!/usr/bin/env bash
set -euo pipefail

task_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$task_root"
evidence_folder=.scratch/tauri-test/linux-desktop
mkdir -p -- "$evidence_folder"

sed '/<keyboard>/a\
  <keybind key="A-F9"><action name="Iconify"/></keybind>\
  <keybind key="A-F10"><action name="ToggleMaximize"/></keybind>' \
  /etc/xdg/openbox/rc.xml >"$evidence_folder/rc.xml"

openbox --sm-disable --config-file "$evidence_folder/rc.xml" >"$evidence_folder/openbox.log" 2>&1 &
window_manager_pid=$!
trap 'kill "$window_manager_pid" 2>/dev/null || true; wait "$window_manager_pid" 2>/dev/null || true' EXIT

window_manager_ready=false
for _ in {1..100}; do
    if ! kill -0 "$window_manager_pid" 2>/dev/null; then
        cat "$evidence_folder/openbox.log"
        exit 1
    fi
    xprop -root _NET_SUPPORTING_WM_CHECK >"$evidence_folder/window-manager.txt"
    if grep -q 'window id #' "$evidence_folder/window-manager.txt"; then
        window_manager_ready=true
        break
    fi
    sleep 0.05
done
if [[ "$window_manager_ready" != true ]]; then
    printf '%s\n' 'Openbox did not establish the X11 window manager within five seconds.' >&2
    exit 1
fi

npm run tauri-test -- "$@"
