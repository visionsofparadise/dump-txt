import { createMutableState, scope } from "opshot";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppMenu } from "./AppMenu";
import { FontPicker } from "./FontPicker";
import { Keybinds } from "./Keybinds";
import { PageBar } from "./PageBar";
import { PageViewport } from "./PageViewport";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import type { ChromeContext } from "../models/ChromeContext";
import type { ChromeState } from "../models/ChromeState";
import type { DumpContext } from "../models/DumpContext";

interface EditorSurfaceProps {
	readonly context: DumpContext;
}
interface EditorStyle extends CSSProperties {
	readonly "--editor-font": string;
	readonly "--editor-size": string;
	readonly "--status-bar-height": string;
}

export const EditorSurface = scope(({ context: dumpContext }: EditorSurfaceProps) => {
	const { session, editor, persistence } = dumpContext;
	const [chrome] = useState(() => createMutableState<ChromeState>({ menuOpen: false, fontPickerOpen: false, keybindsOpen: false }));
	const context = useMemo<ChromeContext>(
		() => ({ ...dumpContext, chrome }),
		[chrome, dumpContext],
	);
	const dismissMenu = useCallback(() => {
		context.chrome.menuOpen = false;
	}, [context]);
	const { font, textSize, theme, showStatusBar = true } = session.appearance;
	const appearance = useMemo<EditorStyle>(
		() => ({
			"--editor-font": `"${font}", ${/mono|consol|courier|cascadia/iu.test(font) ? "monospace" : /georgia|cambria|times|serif/iu.test(font) ? "serif" : "sans-serif"}`,
			"--editor-size": `${textSize}pt`,
			"--status-bar-height": showStatusBar ? "24px" : "0px",
		}),
		[font, textSize, showStatusBar],
	);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || chrome.fontPickerOpen || chrome.keybindsOpen) return;

			const dump = persistence.context;

			if (!dump) return;

			const control = event.ctrlKey || event.metaKey;
			const key = event.key.toLowerCase();
			let command: (() => void) | undefined;

			if (control && !event.altKey) {
				if (key === "o" && !event.shiftKey)
					command = () => {
						void persistence.open().catch(() => undefined);
					};
				else if (key === "n")
					command = () => editor.apply({ type: "insertPage", position: event.shiftKey ? "above" : "below" });
				else if (key === "s" && event.shiftKey)
					command = () => {
						void persistence.saveAs().catch(() => undefined);
					};
				else if (["+", "=", "-", "0"].includes(key))
					command = () => {
						dump.session.appearance = {
							...dump.session.appearance,
							textSize: key === "0" ? 11 : Math.max(8, Math.min(24, dump.session.appearance.textSize + (key === "-" ? -1 : 1))),
						};
					};
				else if (key === "f" && !event.shiftKey) command = () => editor.openFind();
				else if (key === "delete" && !event.shiftKey) command = () => editor.apply({ type: "deletePage" });
				else if ((key === "home" || key === "end") && !event.shiftKey)
					command = () => {
						const page = key === "home" ? dump.document.pages[0] : dump.document.pages.at(-1);

						if (page) editor.showPage(page.id);
					};
			} else if (key === "f3" && !control && !event.altKey)
				command = () => editor.nextFind(event.shiftKey ? -1 : 1);
			else if (!control && !event.shiftKey && (event.altKey || key === "pageup" || key === "pagedown")) {
				const index = dump.document.pages.findIndex((page) => page.id === dump.session.view.activePageId);
				const target =
					key === "arrowup" || key === "pageup"
						? index - 1
						: key === "arrowdown" || key === "pagedown"
							? index + 1
							: null;

				if (target !== null)
					command = () => {
						const page = dump.document.pages[target];

						if (page) editor.showPage(page.id);
					};
			}

			if (command) {
				event.preventDefault();

				if (!persistence.state.locked) command();
			}
		};

		window.addEventListener("keydown", keydown);

		return () => window.removeEventListener("keydown", keydown);
	}, [chrome, editor, persistence]);

	return (
		<main className="dump-app" style={appearance}>
			<TitleBar chrome={context.chrome} onDismissMenu={dismissMenu} context={context}>
				<AppMenu context={context} />
			</TitleBar>
			<PageBar position="top" context={context} />
			<PageViewport context={context} />
			<PageBar position="bottom" context={context} />
			{showStatusBar && <StatusBar context={context} />}
			<FontPicker context={context} />
			<Keybinds context={context} />
		</main>
	);
});
