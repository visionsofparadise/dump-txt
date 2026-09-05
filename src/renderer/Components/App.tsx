import { scope } from "opshot";
import { useEffect, useMemo } from "react";
import { createDocumentState } from "../models/DocumentState";
import { EditorController } from "../models/EditorController";
import { History } from "../models/History";
import { createSessionState } from "../models/SessionState";
import { PageEditor } from "./PageEditor";

export function App() {
	const context = useMemo(() => {
		const document = createDocumentState();
		const session = createSessionState(document.pages);
		const history = new History(document, session);
		const editor = new EditorController(document, session, history);

		return { document, session, history, editor };
	}, []);

	useEffect(
		() => () => {
			context.editor.dispose();
			context.history.dispose();
		},
		[context],
	);

	return <EditorSurface context={context} />;
}

interface EditorSurfaceProps {
	readonly context: {
		readonly document: ReturnType<typeof createDocumentState>;
		readonly session: ReturnType<typeof createSessionState>;
		readonly history: History;
		readonly editor: EditorController;
	};
}

const EditorSurface = scope(({ context }: EditorSurfaceProps) => {
	const { document, session, editor, history } = context;
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
		history.undo();
		editor.refresh();
	};
	const redo = () => {
		history.redo();
		editor.refresh();
	};

	return (
		<main className="grid h-full grid-rows-[32px_minmax(0,1fr)_32px]">
			<div className="flex items-center gap-4 bg-bar px-3 text-xs">
				<button onClick={insertAbove}>Insert above</button>
				<button onClick={previous}>Previous</button>
				<button onClick={undo} disabled={!session.canUndo}>
					Undo
				</button>
				<button onClick={redo} disabled={!session.canRedo}>
					Redo
				</button>
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
