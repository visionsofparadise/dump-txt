#!/usr/bin/env bash
set -euo pipefail

task_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$task_root"
evidence_folder=.scratch/tauri-test/linux-desktop
mkdir -p -- "$evidence_folder"

python3 - "$evidence_folder/rc.xml" <<'PYTHON'
import sys
import xml.etree.ElementTree as xml

namespace = "http://openbox.org/3.4/rc"
xml.register_namespace("", namespace)
configuration = xml.parse("/etc/xdg/openbox/rc.xml")
theme = configuration.find(f"{{{namespace}}}theme")
theme.find(f"{{{namespace}}}name").text = "Clearlooks"
theme.find(f"{{{namespace}}}titleLayout").text = "NLIMC"
configuration.write(sys.argv[1], encoding="utf-8", xml_declaration=True)
PYTHON

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
