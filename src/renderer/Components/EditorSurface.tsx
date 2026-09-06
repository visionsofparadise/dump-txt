import { createMutableState, scope } from "opshot";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppMenu } from "./AppMenu";
import { FontPicker } from "./FontPicker";
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
	const [chrome] = useState(() => createMutableState<ChromeState>({ menuOpen: false, fontPickerOpen: false }));
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
			if (event.defaultPrevented || event.isComposing || chrome.fontPickerOpen) return;

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
				else if (key === "s")
					command = () => {
						void (event.shiftKey ? persistence.saveAs() : persistence.flush()).catch(() => undefined);
					};
				else if (key === "w" && !event.shiftKey)
					command = () => {
						void persistence.close().catch(() => undefined);
					};
				else if (key === "f" && !event.shiftKey) command = () => editor.openFind();
				else if (key === "enter" && event.shiftKey)
					command = () => editor.apply({ type: "insertPage", position: "below" });
				else if (key === "delete" && event.shiftKey) command = () => editor.apply({ type: "deletePage" });
			} else if (control && event.altKey && key === "enter")
				command = () => editor.apply({ type: "insertPage", position: "above" });
			else if (event.altKey && !control && !event.shiftKey) {
				const index = dump.document.pages.findIndex((page) => page.id === dump.session.view.activePageId);
				const target =
					key === "arrowup"
						? index - 1
						: key === "arrowdown"
							? index + 1
							: key === "home"
								? 0
								: key === "end"
									? dump.document.pages.length - 1
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
		</main>
	);
});
