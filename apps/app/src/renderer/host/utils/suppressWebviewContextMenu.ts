export function suppressWebviewContextMenu(event: MouseEvent): void {
	if (
		event.target instanceof Element &&
		event.target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")
	)
		return;

	event.preventDefault();
}
