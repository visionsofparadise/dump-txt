import { Keyboard, X } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "../UI/Dialog";
import type { ChromeContext } from "../../models/ChromeContext";

const groups = [
	{
		title: "Pages",
		bindings: [
			["New page below", "Mod+N"],
			["New page above", "Mod+Shift+N"],
			["Previous page", "Page Up / Alt+↑"],
			["Next page", "Page Down / Alt+↓"],
			["First page", "Mod+Home"],
			["Last page", "Mod+End"],
			["Delete page", "Mod+Delete"],
			["Scroll pages", "Shift+Scroll"],
		],
	},
	{
		title: "File",
		bindings: [
			["Open", "Mod+O"],
			["Save As", "Mod+Shift+S"],
		],
	},
	{
		title: "Editing",
		bindings: [
			["Undo", "Mod+Z"],
			["Redo", "Mod+Y / Mod+Shift+Z"],
			["Cut", "Mod+X"],
			["Copy", "Mod+C"],
			["Paste", "Mod+V"],
			["Select all", "Mod+A"],
			["Select next occurrence", "Mod+D"],
			["End occurrence selection", "Esc"],
			["Indent", "Tab"],
			["Unindent", "Ctrl+Tab"],
			["Change text size", "Ctrl+Scroll"],
			["Increase text size", "Mod++"],
			["Decrease text size", "Mod+-"],
			["Reset text size", "Mod+0"],
		],
	},
	{
		title: "Find and replace",
		bindings: [
			["Open find and replace", "Mod+F"],
			["Next result", "F3"],
			["Previous result", "Shift+F3"],
			["Next result (in find input)", "Enter"],
			["Previous result (in find input)", "Shift+Enter"],
			["Close panel", "Esc"],
		],
	},
] as const;

interface KeybindsProps {
	readonly context: ChromeContext;
}

export const Keybinds = scope(({ context }: KeybindsProps) => {
	const { chrome, editor } = context;
	const primaryModifier = context.main.platform === "macos" ? "Command" : "Ctrl";

	const openChanged = useCallback(
		(open: boolean) => {
			chrome.keybindsOpen = open;
		},
		[chrome],
	);

	const close = useCallback(() => {
		chrome.keybindsOpen = false;
	}, [chrome]);

	const restoreFocus = useCallback(
		(event: Event) => {
			event.preventDefault();
			editor.focus();
		},
		[editor],
	);

	return (
		<Dialog open={chrome.keybindsOpen} onOpenChange={openChanged}>
			<DialogContent
				container={context.surface.current}
				className="keybinds-modal"
				aria-describedby={undefined}
				onCloseAutoFocus={restoreFocus}
			>
				<header className="font-picker-header">
					<DialogTitle>
						<Keyboard size={18} aria-hidden />
						Keybinds
					</DialogTitle>
					<button type="button" className="chrome-button" aria-label="Close keybinds" onClick={close}>
						<X size={16} aria-hidden />
					</button>
				</header>
				<div className="keybinds-list" role="region" aria-label="Keyboard shortcuts">
					{groups.map((group) => (
						<section key={group.title} aria-label={group.title}>
							<h2>{group.title}</h2>
							<dl>
								{group.bindings.map(([label, keys]) => (
									<div className="keybind-row" key={label}>
										<dt>{label}</dt>
										<dd>
											<kbd>{keys.replaceAll("Mod+", `${primaryModifier}+`)}</kbd>
										</dd>
									</div>
								))}
							</dl>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
});
