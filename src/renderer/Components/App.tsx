import { scope } from "opshot";
import { useEffect, useMemo } from "react";
import { createMain } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import { PersistenceController } from "../models/PersistenceController";
import { PageEditor } from "./PageEditor";
import { SaveStatus } from "./SaveStatus";
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
		<main className="h-full bg-surface">
			<div className="px-3 py-2 text-xs text-muted">Opening dump…</div>
			<SaveStatus context={context} />
		</main>
	);
});

interface EditorSurfaceProps {
	readonly context: DumpContext;
}

const EditorSurface = scope(({ context }: EditorSurfaceProps) => {
	const { document, session, editor, history, persistence, persistenceState } = context;
	const activeIndex = document.pages.findIndex((page) => page.id === session.view.activePageId);
	const insertAbove = () => editor.apply({ type: "insertPage", position: "above" });
	const insertBelow = () => editor.apply({ type: "insertPage", position: "below" });
	const previous = () => {
		const page = document.pages[activeIndex - 1];

		if (page) editor.showPage(page.id);
		else insertAbove();
	};
	const next = () => {
		const page = document.pages[activeIndex + 1];

		if (page) editor.showPage(page.id);
		else insertBelow();
	};
	const undo = () => {
		if (persistence.state.locked) return;

		editor.finishComposition();
		history.undo();
		editor.refresh();
	};
	const redo = () => {
		if (persistence.state.locked) return;

		editor.finishComposition();
		history.redo();
		editor.refresh();
	};

	return (
		<main className="grid h-full grid-rows-[32px_auto_minmax(0,1fr)_32px]">
			<div className="flex items-center gap-4 bg-bar px-3 text-xs">
				<button disabled={persistenceState.locked} onClick={() => persistence.open()}>
					Open…
				</button>
				<button disabled={persistenceState.locked} onClick={() => persistence.saveAs()}>
					Save As…
				</button>
				<button onClick={insertAbove}>Insert above</button>
				<button onClick={previous}>Previous</button>
				<button onClick={undo} disabled={!session.canUndo || persistenceState.locked}>
					Undo
				</button>
				<button onClick={redo} disabled={!session.canRedo || persistenceState.locked}>
					Redo
				</button>
			</div>
			<div>
				<SaveStatus context={context} />
			</div>
			<PageEditor editor={editor} />
			<div className="flex items-center gap-4 bg-bar px-3 text-xs">
				<button onClick={insertBelow}>Insert below</button>
				<button onClick={next}>Next</button>
				<span>
					{activeIndex + 1} / {document.pages.length}
				</span>
			</div>
		</main>
	);
});
