import { FolderOpen, Keyboard, Menu as MenuIcon, PanelBottom, Redo2, Save, Search, X, Undo2 } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../UI/DropdownMenu";
import { AppearanceMenu } from "./AppearanceMenu";
import { FontMenu } from "./FontMenu";
import { PageFileMenu } from "./PageFileMenu";
import { TextSizeMenu } from "./TextSizeMenu";
import type { ChromeContext } from "../../models/ChromeContext";

interface MenuProps {
	readonly context: ChromeContext;
}

export const Menu = scope(({ context }: MenuProps) => {
	const { session, editor, history, persistence, persistenceState, chrome } = context;

	const menuChanged = useCallback(
		(value: boolean) => {
			editor.finishComposition();
			history.closeGroup();
			chrome.menuOpen = value;
		},
		[chrome, editor, history],
	);

	const openFile = useCallback(() => {
		if (persistence.state.locked) return;

		void persistence.open().catch(() => undefined);
	}, [persistence]);

	const saveAs = useCallback(() => {
		if (persistence.state.locked) return;

		void persistence.saveAs().catch(() => undefined);
	}, [persistence]);

	const undo = useCallback(() => {
		if (persistence.state.locked) return;

		history.undo();
		editor.refresh();
	}, [editor, history, persistence]);

	const redo = useCallback(() => {
		if (persistence.state.locked) return;

		history.redo();
		editor.refresh();
	}, [editor, history, persistence]);

	const find = useCallback(() => {
		if (!persistence.state.locked) editor.openFind();
	}, [editor, persistence]);

	const close = useCallback(() => {
		void persistence.close().catch(() => undefined);
	}, [persistence]);

	const openKeybinds = useCallback(() => {
		chrome.keybindsOpen = true;
	}, [chrome]);

	const toggleStatusBar = useCallback(() => {
		if (persistence.state.locked) return;

		session.appearance = {
			...session.appearance,
			showStatusBar: !(session.appearance.showStatusBar ?? true),
		};
	}, [persistence, session]);

	const restoreFocus = useCallback(
		(event: Event) => {
			event.preventDefault();

			if (!session.find.open && !chrome.fontPickerOpen && !chrome.keybindsOpen) editor.focus();
		},
		[chrome, editor, session],
	);

	return (
		<DropdownMenu modal={false} open={chrome.menuOpen} onOpenChange={menuChanged}>
			<DropdownMenuTrigger asChild>
				<button
					className="chrome-button menu-trigger"
					aria-label="App menu"
					title="App menu"
					disabled={persistenceState.locked}
				>
					<MenuIcon size={16} aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				container={context.surface.current}
				align={context.main.platform === "macos" ? "end" : "start"}
				onCloseAutoFocus={restoreFocus}
			>
				<DropdownMenuItem onSelect={openFile} disabled={persistenceState.locked}>
					<FolderOpen size={16} aria-hidden />
					<span>Open…</span>
					<span className="menu-shortcut">Ctrl+O</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={saveAs} disabled={persistenceState.locked}>
					<Save size={16} aria-hidden />
					<span>Save As…</span>
					<span className="menu-shortcut">Ctrl+Shift+S</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<PageFileMenu context={context} />
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={undo} disabled={!session.canUndo || persistenceState.locked}>
					<Undo2 size={16} aria-hidden />
					<span>Undo</span>
					<span className="menu-shortcut">Ctrl+Z</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={redo} disabled={!session.canRedo || persistenceState.locked}>
					<Redo2 size={16} aria-hidden />
					<span>Redo</span>
					<span className="menu-shortcut">Ctrl+Y</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={find} disabled={persistenceState.locked}>
					<Search size={16} aria-hidden />
					<span>Find and replace</span>
					<span className="menu-shortcut">Ctrl+F</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<TextSizeMenu context={context} />
				<FontMenu context={context} />
				<AppearanceMenu context={context} />
				<DropdownMenuItem onSelect={toggleStatusBar} disabled={persistenceState.locked}>
					<PanelBottom size={16} aria-hidden />
					<span>{session.appearance.showStatusBar === false ? "Show status bar" : "Hide status bar"}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={openKeybinds} disabled={persistenceState.locked}>
					<Keyboard size={16} aria-hidden />
					<span>Keybinds</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={close} disabled={persistenceState.locked}>
					<X size={16} aria-hidden />
					<span>Close</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
});
