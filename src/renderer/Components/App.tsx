import { scope } from "opshot";
import { useEffect, useMemo, type CSSProperties } from "react";
import { createMain } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import { PersistenceController } from "../models/PersistenceController";
import { AppMenu } from "./AppMenu";
import { PageBar } from "./PageBar";
import { PageViewport } from "./PageViewport";
import { SaveStatus } from "./SaveStatus";
import { TitleBar } from "./TitleBar";
import type { AppContext } from "../models/AppContext";
import type { DumpContext } from "../models/DumpContext";

export function App() {
	const context = useMemo(() => {
		const main = createMain(window.main);
		const events = new MainEvents(main);
		const persistence = new PersistenceController(main, events);

		return { main, events, persistence, persistenceState: persistence.state };
	}, []);

	useEffect(() => {
		void context.persistence.initialize().catch((error: unknown) => console.error(error));

		return () => {
			context.persistence.dispose();
			context.events.dispose();
		};
	}, [context]);

	return <DumpLoader context={context} />;
}

interface DumpLoaderProps {
	readonly context: AppContext;
}

const DumpLoader = scope(({ context }: DumpLoaderProps) => {
	const { persistence, persistenceState } = context;
	const generation = persistenceState.generation;
	const dump = persistence.context;

	return dump ? (
		<EditorSurface key={generation} context={dump} />
	) : (
		<main className="loading-app">
			<TitleBar context={context} />
			<div className="loading-copy">Opening dump…</div>
			<SaveStatus context={context} />
		</main>
	);
});

interface EditorSurfaceProps {
	readonly context: DumpContext;
}
interface EditorStyle extends CSSProperties {
	readonly "--editor-font": string;
	readonly "--editor-size": string;
}

const EditorSurface = scope(({ context }: EditorSurfaceProps) => {
	const { session, editor, persistence } = context;
	const { font, textSize, theme } = session.appearance;
	const appearance = useMemo<EditorStyle>(
		() => ({
			"--editor-font": `"${font}", ${/mono|consol|courier|cascadia/iu.test(font) ? "monospace" : /georgia|cambria|times|serif/iu.test(font) ? "serif" : "sans-serif"}`,
			"--editor-size": `${textSize}pt`,
		}),
		[font, textSize],
	);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;

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
	}, [editor, persistence]);

	return (
		<main className="dump-app" style={appearance}>
			<TitleBar context={context}>
				<AppMenu context={context} />
			</TitleBar>
			<PageBar position="top" context={context} />
			<PageViewport context={context} />
			<PageBar position="bottom" context={context} />
		</main>
	);
});
