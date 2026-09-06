import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flush } from "opshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as occurrenceMatches from "../utils/occurrenceMatchesOf";
import { createDocumentState } from "./DocumentState";
import { EditorController } from "./EditorController";
import { PageNavigation } from "./PageNavigation";
import { History } from "./History";
import { createSessionState } from "./SessionState";

const controllers: EditorController[] = [];

beforeEach(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
	Object.defineProperties(Range.prototype, {
		getClientRects: { configurable: true, value: () => [] },
		getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
	});
});

function fixture(callbacks: ConstructorParameters<typeof EditorController>[4] = {}) {
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
	const navigation = new PageNavigation(documentState, session);
	const controller = new EditorController(documentState, session, history, navigation, callbacks);
	controllers.push(controller);
	const parent = document.createElement("div");
	document.body.append(parent);
	controller.attach(parent);
	const editor = parent.querySelector<HTMLElement>(".cm-editor")!;
	const view = EditorView.findFromDOM(editor)!;
	return { documentState, session, history, controller, navigation, view };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	for (const controller of controllers.splice(0)) controller.dispose();
	document.body.replaceChildren();
});

describe("CodeMirror bridge", () => {
	it.each(["cut", "paste", "delete", "undo", "redo"] as const)("rejects native %s while locked", async (intent) => {
		const readClipboard = vi.fn(async () => "replacement");
		const writeClipboard = vi.fn(async () => undefined);
		const { view, controller, documentState, history } = fixture({
			showTextContextMenu: async () => intent,
			readClipboard,
			writeClipboard,
		});
		controller.setLocked(true);
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await Promise.resolve();
		expect(readClipboard).not.toHaveBeenCalled();
		expect(writeClipboard).not.toHaveBeenCalled();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it.each([false, true])("copies cross-page text in document order with locked=%s", async (locked) => {
		const writeClipboard = vi.fn(async () => undefined);
		const { view, controller, history, documentState } = fixture({
			showTextContextMenu: async () => "copy",
			writeClipboard,
		});
		controller.setLocked(locked);
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("cat\ncat"));
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it("cuts cross-page selections only after writing and records one reversible edit", async () => {
		let complete!: () => void;
		const writeClipboard = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				}),
		);
		const { view, documentState, history } = fixture({ showTextContextMenu: async () => "cut", writeClipboard });
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("cat\ncat"));
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		complete();
		await vi.waitFor(() => expect(documentState.pages.map((page) => page.text)).toEqual([" one", "two "]));
		history.undo();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it("pastes native Unicode clipboard text through the existing cross-page edit", async () => {
		const { view, documentState, history } = fixture({
			showTextContextMenu: async () => "paste",
			readClipboard: async () => "中文 👩‍💻",
		});
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await vi.waitFor(() =>
			expect(documentState.pages.map((page) => page.text)).toEqual(["中文 👩‍💻 one", "two 中文 👩‍💻"]),
		);
		history.undo();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it("preserves cross-page selections when the native clipboard has no text", async () => {
		const readClipboard = vi.fn(async () => "");
		const { view, documentState, session, history } = fixture({
			showTextContextMenu: async () => "paste",
			readClipboard,
		});
		const selections = JSON.stringify(session.view);
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(readClipboard).toHaveBeenCalledOnce());
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(JSON.stringify(session.view)).toBe(selections);
		expect(history.canUndo).toBe(false);
	});

	it.each(["cut", "paste"] as const)(
		"preserves text and history when native %s clipboard access fails",
		async (intent) => {
			const failure = () => Promise.reject(new Error("Clipboard busy"));
			const { view, documentState, history } = fixture({
				showTextContextMenu: async () => intent,
				readClipboard: failure,
				writeClipboard: failure,
			});
			vi.spyOn(view, "posAtCoords").mockReturnValue(1);
			view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
			await Promise.resolve();
			await Promise.resolve();
			expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
			expect(history.canUndo).toBe(false);
		},
	);

	it.each([false, true])("selects the active page and ends occurrence mode with locked=%s", async (locked) => {
		const { view, controller, session, history } = fixture({ showTextContextMenu: async () => "selectAll" });
		controller.setLocked(locked);
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(view.state.selection.main.to).toBe(7));
		expect(view.state.selection.main.from).toBe(0);
		expect(session.view.occurrence).toBeNull();
		expect(history.canUndo).toBe(false);
	});

	for (const intent of ["cut", "paste"] as const) {
		it.each([
			"lock",
			"detach",
			"selection",
			"selectionRestored",
			"page",
			"scope",
			"offPage",
			"editUndo",
			"composition",
			"newMenu",
		] as const)(`rejects pending native ${intent} after %s changes`, async (change) => {
			let complete!: () => void;
			const pending = new Promise<void>((resolve) => {
				complete = resolve;
			});
			const writeClipboard = vi.fn(() => pending);
			const readClipboard = vi.fn(async () => {
				await pending;
				return "replacement";
			});
			const showTextContextMenu = vi
				.fn<() => Promise<typeof intent | null>>()
				.mockResolvedValueOnce(intent)
				.mockResolvedValue(null);
			const { view, controller, documentState, session, history } = fixture({
				showTextContextMenu,
				writeClipboard,
				readClipboard,
			});
			vi.spyOn(view, "posAtCoords").mockReturnValue(1);
			const open = () =>
				view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
			open();
			await vi.waitFor(() => expect(intent === "cut" ? writeClipboard : readClipboard).toHaveBeenCalledOnce());
			if (change === "lock") {
				controller.setLocked(true);
				controller.setLocked(false);
			} else if (change === "detach") controller.detach();
			else if (change === "selection" || change === "selectionRestored") {
				const selection = view.state.selection;
				view.dispatch({ selection: EditorSelection.cursor(5) });
				if (change === "selectionRestored") view.dispatch({ selection });
			} else if (change === "page") controller.showPage("second");
			else if (change === "scope") controller.updateOccurrenceOptions({ allPages: false });
			else if (change === "offPage")
				documentState.pages = [documentState.pages[0]!, { id: "second", text: "changed" }];
			else if (change === "editUndo") {
				controller.apply({ type: "insert", text: "dog" });
				history.undo();
				controller.refresh();
			} else if (change === "composition")
				view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
			else open();
			flush(documentState);
			flush(session);
			const expected = documentState.pages.map((page) => page.text);
			complete();
			await pending;
			await Promise.resolve();
			await Promise.resolve();
			expect(documentState.pages.map((page) => page.text)).toEqual(expected);
		});
	}

	it("preserves right-clicked occurrence targets and deletes them through one global history entry", async () => {
		const showTextContextMenu = vi.fn(async () => "delete" as const);
		const { view, documentState, history, session } = fixture({ showTextContextMenu });
		vi.spyOn(view, "posAtCoords").mockReturnValue(1);
		view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true }));
		expect(session.view.occurrence?.targets).toHaveLength(2);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true }));
		expect(showTextContextMenu).toHaveBeenCalledWith({
			canUndo: false,
			canRedo: false,
			hasSelection: true,
			locked: false,
		});
		await vi.waitFor(() => expect(documentState.pages.map((page) => page.text)).toEqual([" one", "two "]));
		history.undo();
		expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		expect(history.canUndo).toBe(false);
	});

	it("moves an outside right-click to its caret and leaves cancellation without history", async () => {
		const showTextContextMenu = vi.fn(async () => null);
		const { view, history, session } = fixture({ showTextContextMenu });
		vi.spyOn(view, "posAtCoords").mockReturnValue(5);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true }));
		await Promise.resolve();
		expect(view.state.selection.main.anchor).toBe(5);
		expect(view.state.selection.main.empty).toBe(true);
		expect(session.view.occurrence).toBeNull();
		expect(showTextContextMenu).toHaveBeenCalledWith({
			canUndo: false,
			canRedo: false,
			hasSelection: false,
			locked: false,
		});
		expect(history.canUndo).toBe(false);
	});

	it.each(["undo", "redo"] as const)("routes native %s through Opshot", async (response) => {
		const { view, controller, history, documentState } = fixture({ showTextContextMenu: async () => response });
		controller.apply({ type: "insert", text: "dog" });
		if (response === "redo") history.undo();
		vi.spyOn(view, "posAtCoords").mockReturnValue(null);
		view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(documentState.pages[0]?.text).toBe(response === "undo" ? "cat one" : "dog one"));
	});

	it.each(["lock", "detach", "selection", "page"] as const)(
		"rejects pending native menu results after %s changes",
		async (change) => {
			let complete!: (response: "delete") => void;
			const showTextContextMenu = () =>
				new Promise<"delete">((resolve) => {
					complete = resolve;
				});
			const { view, controller, documentState } = fixture({ showTextContextMenu });
			vi.spyOn(view, "posAtCoords").mockReturnValue(1);
			view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true }));
			if (change === "lock") {
				controller.setLocked(true);
				controller.setLocked(false);
			} else if (change === "detach") controller.detach();
			else if (change === "selection") view.dispatch({ selection: EditorSelection.cursor(5) });
			else controller.showPage("second");
			complete("delete");
			await Promise.resolve();
			expect(documentState.pages.map((page) => page.text)).toEqual(["cat one", "two cat"]);
		},
	);
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

	it("keeps rapid page navigation independent of restoration and stale animation completion", async () => {
		const { controller, view, session, documentState, navigation } = fixture();
		controller.closeOccurrence();
		documentState.pages = [...documentState.pages, { id: "third", text: "last page" }];
		flush(documentState);
		const transitions: Array<string> = [];
		let incoming: string | null = null;
		controller.subscribePageTransition((transition) => {
			if (transition) transitions.push(transition.id);
			incoming = transition?.incoming ? transition.id : null;
		});

		navigation.handleWheel(new WheelEvent("wheel", { shiftKey: true, deltaY: 120 }));
		const superseded = transitions.at(-1)!;
		expect(session.view.activePageId).toBe("second");
		navigation.handleWheel(new WheelEvent("wheel", { shiftKey: true, deltaY: 120 }));
		expect(session.view.activePageId).toBe("third");
		expect(view.state.doc.toString()).toBe("last page");
		const latest = transitions.at(-1)!;
		controller.finishPageTransition(superseded);
		await vi.waitFor(() => expect(incoming).toBe(latest));
		navigation.handleWheel(new WheelEvent("wheel", { deltaY: -120 }));
		expect(session.view.activePageId).toBe("second");
		expect(view.state.doc.toString()).toBe("two cat");
		const reversed = transitions.at(-1)!;
		controller.finishPageTransition(latest);
		await vi.waitFor(() => expect(incoming).toBe(reversed));
		expect(session.view.activePageId).toBe("second");
	});

	it("keeps the incoming slide when modifier keys are pressed, but cancels for editing input", async () => {
		const { controller, view, navigation } = fixture();
		controller.closeOccurrence();
		let active: string | null = null;
		let ready = false;
		controller.subscribePageTransition((transition) => {
			active = transition?.id ?? null;
			ready = transition?.incoming !== null && transition?.incoming !== undefined;
		});
		navigation.navigate(1);
		const transition = active;
		expect(transition).not.toBeNull();
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true }));
		expect(active).toBe(transition);
		await vi.waitFor(() => expect(ready).toBe(true));
		for (const key of ["Shift", "Control", "Alt", "Meta", "AltGraph"])
			view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		expect(active).toBe(transition);
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
		expect(active).toBeNull();
	});

	it("requires excess editor scrolling and keeps bar navigation independent", async () => {
		const { controller, view, session, navigation } = fixture();
		controller.closeOccurrence();
		view.dispatch({ selection: EditorSelection.cursor(0) });
		let now = 1000;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		Object.defineProperties(view.scrollDOM, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 500 },
			scrollTo: { configurable: true, value: vi.fn() },
		});
		view.scrollDOM.scrollTop = 100;
		const ordinary = new WheelEvent("wheel", { deltaY: 300, cancelable: true });
		controller.handleWheel(ordinary);
		expect(ordinary.defaultPrevented).toBe(true);
		view.scrollDOM.scrollTop = 400;
		controller.handleWheel(new WheelEvent("wheel", { deltaY: 200 }));
		expect(session.view.activePageId).toBe("first");
		controller.handleWheel(new WheelEvent("wheel", { deltaY: 200 }));
		expect(session.view.activePageId).toBe("second");
		await vi.waitFor(() => expect(view.scrollDOM.scrollTop).toBe(0));
		await new Promise((resolve) => setTimeout(resolve, 100));
		navigation.handleWheel(new WheelEvent("wheel", { deltaY: 100 }));
		expect(session.view.activePageId).toBe("second");
		view.dispatch({ selection: EditorSelection.cursor(0) });
		now += 301;
		navigation.handleWheel(new WheelEvent("wheel", { deltaY: -1, deltaMode: 1 }));
		expect(session.view.activePageId).toBe("first");
	});

	it("consumes control wheel before navigation, clamps sizing, and honors composition and locking", () => {
		const { controller, session, view } = fixture();
		session.appearance = { ...session.appearance, textSize: 23 };
		const wheel = new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, cancelable: true });
		controller.handleWheel(wheel);
		expect(wheel.defaultPrevented).toBe(true);
		expect(session.appearance.textSize).toBe(24);
		controller.handleWheel(wheel);
		expect(session.appearance.textSize).toBe(24);
		expect(session.view.activePageId).toBe("first");
		controller.setLocked(true);
		controller.handleWheel(new WheelEvent("wheel", { ctrlKey: true, deltaY: 1 }));
		expect(session.appearance.textSize).toBe(24);
		controller.setLocked(false);
		session.appearance = { ...session.appearance, textSize: 8 };
		controller.handleWheel(new WheelEvent("wheel", { ctrlKey: true, deltaY: 1 }));
		expect(session.appearance.textSize).toBe(8);
		view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		controller.handleWheel(wheel);
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
