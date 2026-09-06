import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as occurrenceMatches from "../utils/occurrenceMatchesOf";
import { createDocumentState } from "./DocumentState";
import { EditorController } from "./EditorController";
import { History } from "./History";
import { createSessionState } from "./SessionState";

const controllers: EditorController[] = [];

beforeEach(() => {
	Object.defineProperties(Range.prototype, {
		getClientRects: { configurable: true, value: () => [] },
		getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
	});
});

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
	vi.restoreAllMocks();
	for (const controller of controllers.splice(0)) controller.dispose();
	document.body.replaceChildren();
});

describe("CodeMirror bridge", () => {
	it.each(["😀", "a", "😀a", "  ", "a\nb"])("previews literal %j only above one Unicode code point", (seed) => {
		const { controller, view, documentState, history } = fixture();
		controller.closeOccurrence();
		documentState.pages = [{ id: "first", text: `${seed}---${seed}` }];
		controller.refresh();
		view.dispatch({ selection: EditorSelection.range(0, seed.length) });
		const previews = view.dom.querySelectorAll(".cm-occurrence-preview");
		expect(Array.from(previews, (element) => element.textContent).join("\n")).toBe(
			Array.from(seed).length > 1 ? seed : "",
		);
		expect(history.canUndo).toBe(false);
		view.dispatch({ selection: EditorSelection.cursor(0) });
		expect(view.dom.querySelector(".cm-occurrence-preview")).toBeNull();
	});
	it("updates previews with case preferences and consumes the next preview on the first press", () => {
		const { controller, view, documentState, session, history } = fixture();
		controller.closeOccurrence();
		documentState.pages = [{ id: "first", text: "cat CAT cat" }];
		controller.refresh();
		view.dispatch({ selection: EditorSelection.range(0, 3) });
		expect(view.dom.querySelectorAll(".cm-occurrence-preview")).toHaveLength(2);
		controller.updateOccurrenceOptions({ matchCase: true });
		controller.refresh();
		expect(view.dom.querySelectorAll(".cm-occurrence-preview")).toHaveLength(1);
		controller.selectNextOccurrence();
		expect(session.view.occurrence?.targets).toHaveLength(2);
		expect(view.dom.querySelectorAll(".cm-active-selection")).toHaveLength(2);
		expect(view.dom.querySelector(".cm-occurrence-preview")).toBeNull();
		controller.apply({ type: "insert", text: "dog" });
		expect(documentState.pages[0]?.text).toBe("dog CAT dog");
		history.undo();
		expect(documentState.pages[0]?.text).toBe("cat CAT cat");
	});
	it("previews unselected matches on other pages only in the active occurrence scope", () => {
		const { controller, view, documentState } = fixture();
		controller.closeOccurrence();
		documentState.pages = [
			{ id: "first", text: "cat cat" },
			{ id: "second", text: "cat cat" },
		];
		controller.refresh();
		view.dispatch({ selection: EditorSelection.range(0, 3) });
		controller.selectNextOccurrence();
		controller.showPage("second");
		expect(view.dom.querySelector(".cm-occurrence-preview")).toBeNull();
		controller.updateOccurrenceOptions({ allPages: true });
		controller.showPage("second");
		expect(view.dom.querySelectorAll(".cm-occurrence-preview")).toHaveLength(2);
	});
	it("caches candidate scans across refreshes and avoids them during ordinary large-page typing", () => {
		const { controller, view, documentState } = fixture();
		controller.closeOccurrence();
		documentState.pages = [{ id: "first", text: `cat ${"x".repeat(1048568)} cat` }];
		controller.refresh();
		const matching = vi.spyOn(occurrenceMatches, "occurrenceMatchesOf");
		view.dispatch({ selection: EditorSelection.range(0, 3) });
		expect(matching).toHaveBeenCalledTimes(1);
		controller.refresh();
		controller.refresh();
		expect(matching).toHaveBeenCalledTimes(1);
		controller.selectNextOccurrence();
		expect(
			matching.mock.calls.filter(([, context]) => context.document.pages[0]?.text.length === 1048576),
		).toHaveLength(2);
		view.dispatch({ selection: EditorSelection.cursor(0) });
		matching.mockClear();
		view.dispatch({ changes: { from: 0, insert: "x" }, selection: EditorSelection.cursor(1) });
		expect(matching).not.toHaveBeenCalled();
	});
	it("covers replacement synchronously with inert snapshots and cancels before destination input", () => {
		const { controller, view, documentState } = fixture();
		controller.closeOccurrence();
		view.contentDOM.id = "active-editor";
		const transitions: Array<Parameters<Parameters<EditorController["subscribePageTransition"]>[0]>[0]> = [];
		const unsubscribe = controller.subscribePageTransition((transition) => transitions.push(transition));
		controller.showPage("second");
		const transition = transitions.at(-1)!;
		expect(transition?.outgoing.dom.textContent).toContain("cat one");
		expect(transition?.incoming).toBeNull();
		expect(transition?.outgoing.dom.querySelector("[id]")).toBeNull();
		expect(transition?.outgoing.dom.querySelector("[contenteditable=true]")).toBeNull();
		expect(view.dom.parentElement?.classList.contains("page-editor-covered")).toBe(true);
		view.dispatch({ changes: { from: 0, insert: "now " } });
		expect(documentState.pages[1]?.text).toBe("now two cat");
		expect(view.dom.parentElement?.classList.contains("page-editor-covered")).toBe(false);
		expect(transitions.at(-1)).toBeNull();
		unsubscribe();
	});

	it("ignores completion from a replaced transition and cancels on resize", () => {
		const { controller, view } = fixture();
		let id = "";
		controller.subscribePageTransition((transition) => {
			if (transition) id = transition.id;
		});
		controller.showPage("second");
		const previous = id;
		controller.showPage("first");
		controller.finishPageTransition(previous);
		expect(view.dom.parentElement?.classList.contains("page-editor-covered")).toBe(true);
		window.dispatchEvent(new Event("resize"));
		expect(view.dom.parentElement?.classList.contains("page-editor-covered")).toBe(false);
	});

	it("restores persisted scroll only after measurement without saving intermediate positions", async () => {
		const { controller, view, session } = fixture();
		Object.defineProperties(view.scrollDOM, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 1000 },
		});
		controller.closeOccurrence();
		session.view = {
			...session.view,
			selections: {
				...session.view.selections,
				second: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 321 },
			},
		};
		controller.showPage("second");
		view.scrollDOM.scrollTop = 17;
		view.scrollDOM.dispatchEvent(new Event("scroll"));
		expect(session.view.selections.second?.scrollTop).toBe(321);
		await vi.waitFor(() => expect(view.scrollDOM.scrollTop).toBe(321));
	});

	it("requires excess editor scrolling and rearms bar navigation after an idle gap", () => {
		const { controller, view, session } = fixture();
		controller.closeOccurrence();
		view.dispatch({ selection: EditorSelection.cursor(0) });
		let now = 1000;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		Object.defineProperties(view.scrollDOM, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 500 },
		});
		view.scrollDOM.scrollTop = 100;
		const ordinary = new WheelEvent("wheel", { deltaY: 300, cancelable: true });
		controller.handleWheel(ordinary, "editor");
		expect(ordinary.defaultPrevented).toBe(false);
		view.scrollDOM.scrollTop = 400;
		controller.handleWheel(new WheelEvent("wheel", { deltaY: 40 }), "editor");
		expect(session.view.activePageId).toBe("first");
		controller.handleWheel(new WheelEvent("wheel", { deltaY: 40 }), "editor");
		expect(session.view.activePageId).toBe("second");
		controller.handleWheel(new WheelEvent("wheel", { deltaY: -100 }), "bar");
		expect(session.view.activePageId).toBe("second");
		view.dispatch({ selection: EditorSelection.cursor(0) });
		now += 301;
		controller.handleWheel(new WheelEvent("wheel", { deltaY: -1, deltaMode: 1 }), "bar");
		expect(session.view.activePageId).toBe("first");
	});

	it("consumes control wheel before navigation, clamps sizing, and honors composition and locking", () => {
		const { controller, session, view } = fixture();
		session.appearance = { ...session.appearance, textSize: 23 };
		const wheel = new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, cancelable: true });
		controller.handleWheel(wheel, "editor");
		expect(wheel.defaultPrevented).toBe(true);
		expect(session.appearance.textSize).toBe(24);
		controller.handleWheel(wheel, "editor");
		expect(session.appearance.textSize).toBe(24);
		expect(session.view.activePageId).toBe("first");
		controller.setLocked(true);
		controller.handleWheel(new WheelEvent("wheel", { ctrlKey: true, deltaY: 1 }), "editor");
		expect(session.appearance.textSize).toBe(24);
		controller.setLocked(false);
		session.appearance = { ...session.appearance, textSize: 8 };
		controller.handleWheel(new WheelEvent("wheel", { ctrlKey: true, deltaY: 1 }), "editor");
		expect(session.appearance.textSize).toBe(8);
		view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		controller.handleWheel(wheel, "editor");
		expect(session.appearance.textSize).toBe(8);
	});
	it("reconciles current-page find after navigation and replaces from the visible cursor", () => {
		const { controller, session, documentState } = fixture();
		controller.closeOccurrence();
		documentState.pages = [
			{ id: "first", text: "cat cat" },
			{ id: "second", text: "cat cat" },
		];
		session.view = {
			...session.view,
			selections: {
				first: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 },
				second: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 },
			},
		};
		controller.refresh();
		controller.openFind();
		controller.updateFind({ query: "cat", replacement: "dog", allPages: false });
		controller.nextFind(1);
		expect(session.find.activeMatch).toBe(1);
		controller.showPage("second");
		expect(session.find.activeMatch).toBe(-1);
		controller.replaceFind(false);
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat cat", "dog cat"]);
	});

	it("reconciles find indexes after text edits and undo restores the selected match", () => {
		const { controller, session, documentState, history } = fixture();
		controller.closeOccurrence();
		documentState.pages = [
			{ id: "first", text: "cat cat" },
			{ id: "second", text: "other" },
		];
		session.view = {
			...session.view,
			selections: { first: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 } },
		};
		controller.refresh();
		controller.openFind();
		controller.updateFind({ query: "cat", replacement: "dog" });
		controller.nextFind(1);
		expect(session.find.activeMatch).toBe(1);
		controller.apply({ type: "replace", matches: [{ pageId: "first", from: 0, to: 3 }], text: "" });
		expect(session.find.activeMatch).toBe(0);
		history.undo();
		expect(session.find.activeMatch).toBe(1);
		controller.apply({ type: "insert", text: "dog" });
		expect(session.find.activeMatch).toBe(-1);
		history.undo();
		expect(session.find.activeMatch).toBe(1);
	});
	it("runs Ctrl+D defaults and reveals next occurrences across pages", () => {
		const { controller, session, view, documentState } = fixture();
		controller.closeOccurrence();
		view.dispatch({ selection: EditorSelection.cursor(1) });
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true, bubbles: true, cancelable: true }),
		);
		expect(session.view.occurrence?.targets).toHaveLength(1);
		controller.updateOccurrenceOptions({ allPages: true });
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true, bubbles: true, cancelable: true }),
		);
		expect(session.view.activePageId).toBe("second");
		expect(view.state.doc.toString()).toBe("two cat");
		controller.apply({ type: "enclose", opening: "[" });
		expect(documentState.pages.map((page) => page.text)).toEqual(["[cat] one", "two [cat]"]);
	});

	it("preserves occurrence mode for Alt page navigation and ends it for selection motion", () => {
		const { session, view, documentState } = fixture();
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }),
		);
		expect(session.view.activePageId).toBe("second");
		expect(session.view.occurrence?.targets).toHaveLength(2);
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
		);
		expect(session.view.occurrence).toBeNull();
	});

	it("opens find through Ctrl+F and replaces across pages as one history entry", () => {
		const { session, view, controller, history, documentState } = fixture();
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true, cancelable: true }),
		);
		expect(session.find.open).toBe(true);
		expect(session.view.occurrence).toBeNull();
		controller.updateFind({ query: "cat", allPages: true, replacement: "dog" });
		controller.replaceFind(true);
		expect(documentState.pages.map((page) => page.text)).toEqual(["dog one", "two dog"]);
		history.undo();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it("keeps replacement input edits on the current match and wraps next/previous", () => {
		const { controller, session } = fixture();
		controller.openFind();
		controller.updateFind({ query: "cat", allPages: true });
		controller.nextFind(1);
		const selected = session.view.activePageId;
		controller.updateFind({ replacement: "x" });
		expect(session.view.activePageId).toBe(selected);
		controller.nextFind(1);
		expect(session.view.activePageId).not.toBe(selected);
		controller.nextFind(-1);
		expect(session.view.activePageId).toBe(selected);
	});

	it("leaves the document and history untouched for an empty find query", () => {
		const { controller, history, documentState, session } = fixture();
		const original = documentState.pages;
		controller.openFind();
		controller.updateFind({ query: "", replacement: "x", allPages: true });
		controller.replaceFind(true);
		expect(documentState.pages).toBe(original);
		expect(history.canUndo).toBe(false);
		expect(session.find.activeMatch).toBe(-1);
	});

	it("keeps find and occurrence preferences independent and Escape collapses to one cursor", () => {
		const { controller, session, view } = fixture();
		controller.updateOccurrenceOptions({ matchCase: true, allPages: true });
		controller.openFind();
		controller.updateFind({ matchCase: false, allPages: false });
		expect(session.occurrencePreferences).toEqual({ matchCase: true, allPages: true });
		controller.closeFind();
		controller.selectNextOccurrence();
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		expect(session.view.occurrence).toBeNull();
		expect(view.state.selection.ranges).toHaveLength(1);
		expect(view.state.selection.main.empty).toBe(true);
	});
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
