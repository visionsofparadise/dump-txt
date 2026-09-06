import { Keyboard, X } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "./UI/Dialog";
import type { ChromeContext } from "../models/ChromeContext";

const groups = [
	{ title: "Pages", bindings: [
		["New page below", "Ctrl+N"],
		["New page above", "Ctrl+Shift+N"],
		["Previous page", "Page Up / Alt+↑"],
		["Next page", "Page Down / Alt+↓"],
		["First page", "Ctrl+Home"],
		["Last page", "Ctrl+End"],
		["Delete page", "Ctrl+Delete"],
		["Scroll pages", "Shift+Scroll"],
	] },
	{ title: "File", bindings: [
		["Open", "Ctrl+O"],
		["Save As", "Ctrl+Shift+S"],
	] },
	{ title: "Editing", bindings: [
		["Undo", "Ctrl+Z"],
		["Redo", "Ctrl+Y / Ctrl+Shift+Z"],
		["Cut", "Ctrl+X"],
		["Copy", "Ctrl+C"],
		["Paste", "Ctrl+V"],
		["Select all", "Ctrl+A"],
		["Select next occurrence", "Ctrl+D"],
		["End occurrence selection", "Esc"],
		["Indent", "Tab"],
		["Unindent", "Ctrl+Tab"],
		["Change text size", "Ctrl+Scroll"],
		["Increase text size", "Ctrl++"],
		["Decrease text size", "Ctrl+-"],
		["Reset text size", "Ctrl+0"],
	] },
	{ title: "Find and replace", bindings: [
		["Open find and replace", "Ctrl+F"],
		["Next result", "F3"],
		["Previous result", "Shift+F3"],
		["Next result (in find input)", "Enter"],
		["Previous result (in find input)", "Shift+Enter"],
		["Close panel", "Esc"],
	] },
] as const;

interface KeybindsProps {
	readonly context: ChromeContext;
}

export const Keybinds = scope(({ context }: KeybindsProps) => {
	const { chrome, editor } = context;
	const openChanged = useCallback((open: boolean) => {
		chrome.keybindsOpen = open;
	}, [chrome]);
	const close = useCallback(() => {
		chrome.keybindsOpen = false;
	}, [chrome]);
	const restoreFocus = useCallback((event: Event) => {
		event.preventDefault();
		editor.focus();
	}, [editor]);

	return (
		<Dialog open={chrome.keybindsOpen} onOpenChange={openChanged}>
			<DialogContent className="keybinds-modal" aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
				<header className="font-picker-header">
					<DialogTitle><Keyboard size={18} aria-hidden />Keybinds</DialogTitle>
					<button type="button" className="chrome-button" aria-label="Close keybinds" onClick={close}>
						<X size={16} aria-hidden />
					</button>
				</header>
				<div className="keybinds-list" tabIndex={0}>
					{groups.map((group) => (
						<section key={group.title} aria-label={group.title}>
							<h2>{group.title}</h2>
							<dl>{group.bindings.map(([label, keys]) => (
								<div className="keybind-row" key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>
							))}</dl>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
});
