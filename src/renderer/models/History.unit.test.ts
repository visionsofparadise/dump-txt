import { batch, createMutableState, flush, subscribe, type Operation } from "opshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentState, freezePages, type Page } from "./DocumentState";
import { History, replayOperation } from "./History";
import { createSessionState, snapshotView, type ViewSnapshot } from "./SessionState";

function fixture(texts: string[] = ["alpha", "beta", "gamma"]) {
	const document = createDocumentState(texts.map((text, index) => ({ id: String(index), text })));
	const session = createSessionState(document.pages);
	const changed = vi.fn();
	const history = new History(document, session, changed);
	const commit = (pages: readonly Page[], group: string | null = null, after = session.view) => {
		history.commit({ pages, group, before: session.view, after });
	};
	return { document, session, changed, history, commit };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Opshot document history", () => {
	it("replays emitted frozen operations across pages and restores selections", () => {
		const { document, session, history, commit, changed } = fixture();
		const before = document.pages;
		const beforeView = session.view;
		const after: ViewSnapshot = {
			...beforeView,
			activePageId: "2",
			selections: {
				...beforeView.selections,
				"2": { ranges: [{ anchor: 2, head: 5 }], mainIndex: 0, scrollTop: 32 },
			},
		};
		const observed: Operation[] = [];
		const stop = subscribe(document, (operations) => observed.push(...operations));
		commit(
			before.map((page) => ({ ...page, text: `${page.text}!` })),
			null,
			after,
		);
		expect(observed).toHaveLength(1);
		expect(observed[0]?.before).toBe(before);
		expect(observed[0]?.after).toBe(document.pages);
		history.undo();
		expect(document.pages).toBe(before);
		expect(session.view).toEqual(beforeView);
		expect(history.canRedo).toBe(true);
		history.redo();
		expect(document.pages.map((page) => page.text)).toEqual(["alpha!", "beta!", "gamma!"]);
		expect(session.view).toEqual(after);
		expect(changed).toHaveBeenCalledTimes(3);
		history.undo();
		expect(history.canUndo).toBe(false);
		stop();
		history.dispose();
	});

	it("handles insertion, deletion, redo, and a fresh edit without stale pages", () => {
		const { document, history, commit } = fixture();
		const initial = document.pages;
		commit([initial[0]!, { id: "new", text: "" }, ...initial.slice(1)]);
		commit(document.pages.filter((page) => page.id !== "1"));
		history.undo();
		expect(document.pages.map((page) => page.id)).toEqual(["0", "new", "1", "2"]);
		history.redo();
		commit(document.pages.map((page) => (page.id === "new" ? { ...page, text: "fresh" } : page)));
		history.undo();
		expect(document.pages.find((page) => page.id === "new")?.text).toBe("");
		history.undo();
		history.undo();
		expect(document.pages).toBe(initial);
		history.dispose();
	});

	it("restores a deleted final page and replacement page IDs", () => {
		const { document, history, commit } = fixture(["last"]);
		commit([{ id: "replacement", text: "" }]);
		history.undo();
		expect(document.pages).toEqual([{ id: "0", text: "last" }]);
		history.redo();
		expect(document.pages).toEqual([{ id: "replacement", text: "" }]);
		history.dispose();
	});

	it("keeps independent commands in one tick separate and invalidates redo", () => {
		const { document, history, commit } = fixture([""]);
		commit([{ id: "0", text: "a" }]);
		commit([{ id: "0", text: "ab" }]);
		history.undo();
		expect(document.pages[0]?.text).toBe("a");
		commit([{ id: "0", text: "ac" }]);
		expect(history.canRedo).toBe(false);
		history.redo();
		expect(document.pages[0]?.text).toBe("ac");
		history.dispose();
	});

	it("groups adjacent typing for 600 ms and closes boundaries explicitly", () => {
		vi.useFakeTimers();
		const { document, history, commit } = fixture([""]);
		commit([{ id: "0", text: "a" }], "typing:0:cursor");
		vi.advanceTimersByTime(600);
		commit([{ id: "0", text: "ab" }], "typing:0:cursor");
		vi.advanceTimersByTime(601);
		commit([{ id: "0", text: "abc" }], "typing:0:cursor");
		history.closeGroup();
		commit([{ id: "0", text: "abcd" }], "typing:0:cursor");
		history.undo();
		expect(document.pages[0]?.text).toBe("abc");
		history.undo();
		expect(document.pages[0]?.text).toBe("ab");
		history.undo();
		expect(document.pages[0]?.text).toBe("");
		history.redo();
		expect(document.pages[0]?.text).toBe("ab");
		history.dispose();
	});

	it("keeps session navigation outside history and freezes captured view data", () => {
		const { document, session, history, commit, changed } = fixture();
		const range = { anchor: 0, head: 2 };
		const view = { ...session.view, selections: { "0": { ranges: [range], mainIndex: 0, scrollTop: 0 } } };
		commit(
			document.pages.map((page) => ({ ...page, text: `${page.text}!` })),
			null,
			view,
		);
		range.head = 99;
		session.view = snapshotView({ ...session.view, activePageId: "1" });
		flush(session);
		expect(changed).toHaveBeenCalledTimes(1);
		history.undo();
		history.redo();
		expect(session.view.selections["0"]?.ranges[0]?.head).toBe(2);
		history.clear();
		expect(session.canUndo).toBe(false);
		expect(session.canRedo).toBe(false);
		history.dispose();
	});

	it("validates immutable page snapshots before applying a command", () => {
		const { document, history, commit } = fixture();
		const initial = document.pages;
		expect(() => commit([])).toThrow("at least one");
		expect(() =>
			freezePages([
				{ id: "same", text: "" },
				{ id: "same", text: "" },
			]),
		).toThrow("unique");
		expect(() => commit([{ id: "1", text: "bad\ftext" }])).toThrow("Form feeds");
		expect(document.pages).toBe(initial);
		history.dispose();
	});
});

describe("operation property presence", () => {
	it("distinguishes an absent property from a stored undefined during replay", () => {
		const state = createMutableState<{ value?: unknown }>({});
		const operations: Operation[] = [];
		const stop = subscribe(state, (emitted) => operations.push(...emitted));
		batch(() => {
			state.value = undefined;
		});
		flush(state);
		const operation = operations[0];
		expect(operation).toBeDefined();
		if (!operation) throw new Error("Expected an emitted operation.");
		expect(Object.hasOwn(operation, "before")).toBe(false);
		expect(Object.hasOwn(operation, "after")).toBe(true);
		replayOperation(operation, "before");
		flush(state);
		expect(Object.hasOwn(state, "value")).toBe(false);
		replayOperation(operation, "after");
		flush(state);
		expect(Object.hasOwn(state, "value")).toBe(true);
		expect(state.value).toBeUndefined();
		stop();
	});
});
