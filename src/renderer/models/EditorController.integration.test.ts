import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentState } from "./DocumentState";
import { EditorController } from "./EditorController";
import { History } from "./History";
import { createSessionState } from "./SessionState";

const controllers: EditorController[] = [];

function fixture() {
	const documentState = createDocumentState([
		{ id: "first", text: "cat one" },
		{ id: "second", text: "two cat" },
	]);
	const session = createSessionState(documentState.pages);
	session.view = {
		...session.view,
		selections: {
			first: { ranges: [{ anchor: 0, head: 3 }], mainIndex: 0, scrollTop: 0 },
			second: { ranges: [{ anchor: 4, head: 7 }], mainIndex: 0, scrollTop: 0 },
		},
		occurrence: {
			seed: "cat",
			seedPageId: "first",
			seedRange: { anchor: 0, head: 3 },
			steps: 2,
			matchCase: false,
			allPages: true,
			targets: [
				{ pageId: "first", range: { anchor: 0, head: 3 } },
				{ pageId: "second", range: { anchor: 4, head: 7 } },
			],
			primaryTarget: 0,
		},
	};
	const history = new History(documentState, session);
	const controller = new EditorController(documentState, session, history);
	controllers.push(controller);
	const parent = document.createElement("div");
	document.body.append(parent);
	controller.attach(parent);
	const editor = parent.querySelector<HTMLElement>(".cm-editor")!;
	const view = EditorView.findFromDOM(editor)!;
	return { documentState, session, history, controller, view };
}

afterEach(() => {
	for (const controller of controllers.splice(0)) controller.dispose();
	document.body.replaceChildren();
});

describe("CodeMirror bridge", () => {
	it("fans actual input transactions out at independent page offsets", () => {
		const { documentState, view, history } = fixture();
		view.dispatch({
			changes: { from: 0, to: 3, insert: "dog" },
			selection: EditorSelection.cursor(3),
			annotations: Transaction.userEvent.of("input.type"),
		});
		expect(documentState.pages.map((page) => page.text)).toEqual(["dog one", "two dog"]);
		expect(view.state.doc.toString()).toBe("dog one");
		history.undo();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(view.state.selection.main.to).toBe(3);
		expect(history.canUndo).toBe(false);
	});

	it("keeps composition updates in the same attached view and commits once", () => {
		const { documentState, view, history, controller } = fixture();
		const content = view.contentDOM;
		content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		view.dispatch({
			changes: { from: 0, to: 3, insert: "に" },
			annotations: Transaction.userEvent.of("input.type.compose"),
		});
		view.dispatch({
			changes: { from: 0, to: 1, insert: "日本" },
			annotations: Transaction.userEvent.of("input.type.compose"),
		});
		expect(view.contentDOM).toBe(content);
		controller.finishComposition();
		expect(documentState.pages.map((page) => page.text)).toEqual(["日本 one", "two 日本"]);
		history.undo();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it("retains shared prefixes and suffixes when composition replaces an occurrence", () => {
		const { documentState, view, history, controller } = fixture();
		view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		view.dispatch({ changes: { from: 0, to: 3, insert: "car" } });
		controller.finishComposition();
		expect(documentState.pages.map((page) => page.text)).toEqual(["car one", "two car"]);
		history.undo();
		expect(documentState.pages[0]!.text).toBe("cat one");
	});

	it.each([true, false])("composes several same-page ranges independently with occurrence mode %s", (occurrence) => {
		const { documentState, session, view, history, controller } = fixture();
		documentState.pages = [{ id: "first", text: "cat + cat" }, documentState.pages[1]!];
		const ranges = [
			{ anchor: 0, head: 3 },
			{ anchor: 6, head: 9 },
		];
		session.view = {
			...session.view,
			selections: { ...session.view.selections, first: { ranges, mainIndex: 1, scrollTop: 0 } },
			occurrence:
				occurrence && session.view.occurrence
					? {
							...session.view.occurrence,
							targets: [
								{ pageId: "first", range: ranges[0]! },
								{ pageId: "first", range: ranges[1]! },
								{ pageId: "second", range: { anchor: 4, head: 7 } },
							],
							primaryTarget: 1,
						}
					: null,
		};
		controller.refresh();
		view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		view.dispatch({
			changes: [
				{ from: 0, to: 3, insert: "cats" },
				{ from: 6, to: 9, insert: "cats" },
			],
		});
		controller.finishComposition();
		expect(documentState.pages.map((page) => page.text)).toEqual([
			"cats + cats",
			occurrence ? "two cats" : "two cat",
		]);
		history.undo();
		expect(documentState.pages[0]!.text).toBe("cat + cat");
		expect(history.canUndo).toBe(false);
	});

	it("cancelling composition creates no history entry", () => {
		const { documentState, view, history, controller } = fixture();
		view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		view.dispatch({ changes: { from: 0, to: 3, insert: "に" } });
		view.dispatch({ changes: { from: 0, to: 1, insert: "cat" } });
		controller.finishComposition();
		expect(documentState.pages[0]!.text).toBe("cat one");
		expect(history.canUndo).toBe(false);
	});

	it("navigation finishes composition and preserves page selections", () => {
		const { session, view, controller, documentState } = fixture();
		view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		view.dispatch({ changes: { from: 0, to: 3, insert: "犬" } });
		controller.showPage("second");
		expect(documentState.pages.map((page) => page.text)).toEqual(["犬 one", "two 犬"]);
		expect(session.view.activePageId).toBe("second");
		expect(view.state.doc.toString()).toBe("two 犬");
	});

	it("holds commands and DOM transactions behind the transition lock", () => {
		const { controller, documentState, view } = fixture();
		controller.setLocked(true);
		controller.apply({ type: "insert", text: "lost" });
		view.dispatch({ changes: { from: 0, insert: "late" } });
		expect(documentState.pages[0]!.text).toBe("cat one");
		expect(view.state.doc.toString()).toBe("cat one");
		controller.setLocked(false);
		controller.apply({ type: "insert", text: "saved" });
		expect(documentState.pages[0]!.text).toBe("saved one");
	});
});
