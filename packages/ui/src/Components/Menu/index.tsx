import { FolderOpen, Keyboard, Menu as MenuIcon, PanelBottom, Redo2, Save, Search, X, Undo2 } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useContext } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import { PlatformContext } from "../../models/PlatformContext";
import { mobilePlatforms } from "../../utils/platformGroups";
import { Button } from "../UI/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
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
	const platform = useContext(PlatformContext) ?? context.main.platform;

	const { session, editor, history, persistence, persistenceState, chrome } = context;
	const capabilities = capabilitiesOf(context.main);

	const menuChanged = useCallback(
		(value: boolean) => {
			editor.finishComposition();
			history.closeGroup();
			chrome.menuOpen = value;
		},
		[chrome, editor, history],
	);

	const openFile = useCallback(() => {
		if (persistence.state.locked || !capabilities.openDump) return;

		void persistence.open().catch(() => undefined);
	}, [capabilities.openDump, persistence]);

	const saveAs = useCallback(() => {
		if (persistence.state.locked || !capabilities.saveAs) return;

		void persistence.saveAs().catch(() => undefined);
	}, [capabilities.saveAs, persistence]);

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
		if (!capabilities.close) return;

		void persistence.close().catch(() => undefined);
	}, [capabilities.close, persistence]);

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
				<Button variant="chrome" aria-label="App menu" title="App menu" disabled={persistenceState.locked}>
					<MenuIcon className="size-icon" aria-hidden />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				container={context.surface.current}
				align={platform === "macos" ? "end" : "start"}
				onCloseAutoFocus={restoreFocus}
			>
				<DropdownMenuItem onSelect={openFile} disabled={persistenceState.locked || !capabilities.openDump}>
					<FolderOpen className="size-icon" aria-hidden />
					<span>Open…</span>
					{capabilities.keybinds && <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={saveAs} disabled={persistenceState.locked || !capabilities.saveAs}>
					<Save className="size-icon" aria-hidden />
					<span>Save As…</span>
					{capabilities.keybinds && <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<PageFileMenu context={context} />
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={undo} disabled={!session.canUndo || persistenceState.locked}>
					<Undo2 className="size-icon" aria-hidden />
					<span>Undo</span>
					{capabilities.keybinds && <DropdownMenuShortcut>Ctrl+Z</DropdownMenuShortcut>}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={redo} disabled={!session.canRedo || persistenceState.locked}>
					<Redo2 className="size-icon" aria-hidden />
					<span>Redo</span>
					{capabilities.keybinds && <DropdownMenuShortcut>Ctrl+Y</DropdownMenuShortcut>}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={find} disabled={persistenceState.locked}>
					<Search className="size-icon" aria-hidden />
					<span>Find and replace</span>
					{capabilities.keybinds && <DropdownMenuShortcut>Ctrl+F</DropdownMenuShortcut>}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<TextSizeMenu context={context} />
				{(!mobilePlatforms.has(platform ?? "windows") || capabilities.fonts) && <FontMenu context={context} />}
				<AppearanceMenu context={context} />
				<DropdownMenuItem onSelect={toggleStatusBar} disabled={persistenceState.locked}>
					<PanelBottom className="size-icon" aria-hidden />
					<span>{session.appearance.showStatusBar === false ? "Show status bar" : "Hide status bar"}</span>
				</DropdownMenuItem>
				{capabilities.keybinds && (
					<DropdownMenuItem onSelect={openKeybinds} disabled={persistenceState.locked}>
						<Keyboard className="size-icon" aria-hidden />
						<span>Keybinds</span>
					</DropdownMenuItem>
				)}
				{(!mobilePlatforms.has(platform ?? "windows") || capabilities.close) && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={close} disabled={persistenceState.locked || !capabilities.close}>
							<X className="size-icon" aria-hidden />
							<span>Close</span>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
});
