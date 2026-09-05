import { CaseSensitive, FolderOpen, Menu, Paintbrush, Redo2, Save, Search, Trash2, Type, Undo2 } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useMemo, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./UI/DropdownMenu";
import type { DumpContext } from "../models/DumpContext";

interface AppMenuProps {
	readonly context: DumpContext;
}

export const AppMenu = scope(({ context }: AppMenuProps) => {
	const { session, editor, history, persistence, persistenceState } = context;
	const [open, setOpen] = useState(false);
	const menuChanged = useCallback(
		(value: boolean) => {
			editor.finishComposition();
			history.closeGroup();
			setOpen(value);
		},
		[editor, history],
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
	const remove = useCallback(() => {
		if (!persistence.state.locked) editor.apply({ type: "deletePage" });
	}, [editor, persistence]);
	const fontChanged = useCallback(
		(font: string) => {
			if (persistence.state.locked) return;

			history.closeGroup();
			session.appearance = { ...session.appearance, font };
		},
		[history, persistence, session],
	);
	const sizeChanged = useCallback(
		(size: string) => {
			if (persistence.state.locked) return;

			const textSize = Number(size);

			if (textSize >= 8 && textSize <= 24) {
				history.closeGroup();
				session.appearance = { ...session.appearance, textSize };
			}
		},
		[history, persistence, session],
	);
	const themeChanged = useCallback(
		(theme: string) => {
			if (persistence.state.locked) return;

			if (theme === "system" || theme === "light" || theme === "dark") {
				history.closeGroup();
				session.appearance = { ...session.appearance, theme };
			}
		},
		[history, persistence, session],
	);
	const restoreFocus = useCallback(
		(event: Event) => {
			event.preventDefault();

			if (!session.find.open) editor.focus();
		},
		[editor, session],
	);

	return (
		<DropdownMenu open={open} onOpenChange={menuChanged}>
			<DropdownMenuTrigger asChild>
				<button
					className="chrome-button menu-trigger"
					aria-label="App menu"
					title="App menu"
					disabled={persistenceState.locked}
				>
					<Menu size={14} aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" onCloseAutoFocus={restoreFocus}>
				<DropdownMenuItem onSelect={openFile} disabled={persistenceState.locked}>
					<FolderOpen size={14} aria-hidden />
					<span>Open…</span>
					<span className="menu-shortcut">Ctrl+O</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={saveAs} disabled={persistenceState.locked}>
					<Save size={14} aria-hidden />
					<span>Save As…</span>
					<span className="menu-shortcut">Ctrl+Shift+S</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={undo} disabled={!session.canUndo || persistenceState.locked}>
					<Undo2 size={14} aria-hidden />
					<span>Undo</span>
					<span className="menu-shortcut">Ctrl+Z</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={redo} disabled={!session.canRedo || persistenceState.locked}>
					<Redo2 size={14} aria-hidden />
					<span>Redo</span>
					<span className="menu-shortcut">Ctrl+Y</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={find} disabled={persistenceState.locked}>
					<Search size={14} aria-hidden />
					<span>Find and replace</span>
					<span className="menu-shortcut">Ctrl+F</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger disabled={persistenceState.locked}>
						<Type size={14} aria-hidden />
						<span>Text size</span>
						<span className="menu-value">{session.appearance.textSize} pt</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value={String(session.appearance.textSize)} onValueChange={sizeChanged}>
							{Array.from({ length: 17 }, (_value, index) => index + 8).map((size) => (
								<DropdownMenuRadioItem key={size} value={String(size)} disabled={persistenceState.locked}>
									{size} pt
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger disabled={persistenceState.locked}>
						<CaseSensitive size={14} aria-hidden />
						<span>Font</span>
						<span className="menu-value">{session.appearance.font}</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value={session.appearance.font} onValueChange={fontChanged}>
							{[
								"Consolas",
								"Cascadia Mono",
								"Segoe UI",
								"Calibri",
								"Arial",
								"Verdana",
								"Tahoma",
								"Georgia",
								"Cambria",
								"Times New Roman",
								"Courier New",
							].map((font) => (
								<FontMenuItem key={font} font={font} disabled={persistenceState.locked} />
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger disabled={persistenceState.locked}>
						<Paintbrush size={14} aria-hidden />
						<span>Appearance</span>
						<span className="menu-value">
							{session.appearance.theme === "system"
								? "System"
								: session.appearance.theme === "light"
									? "Light"
									: "Dark"}
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value={session.appearance.theme} onValueChange={themeChanged}>
							<DropdownMenuRadioItem value="system" disabled={persistenceState.locked}>
								System
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="light" disabled={persistenceState.locked}>
								Light
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="dark" disabled={persistenceState.locked}>
								Dark
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={remove} disabled={persistenceState.locked}>
					<Trash2 size={14} aria-hidden />
					<span>Delete page</span>
					<span className="menu-shortcut">Ctrl+Shift+Delete</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
});

interface FontMenuItemProps {
	readonly font: string;
	readonly disabled: boolean;
}

function FontMenuItem({ font, disabled }: FontMenuItemProps) {
	const style = useMemo(() => ({ fontFamily: font }), [font]);

	return (
		<DropdownMenuRadioItem value={font} disabled={disabled}>
			<span style={style}>{font}</span>
		</DropdownMenuRadioItem>
	);
}
