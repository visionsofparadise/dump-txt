import { afterEach, describe, expect, it } from "vitest";
import { createDocumentState } from "../models/DocumentState";
import { EditorController } from "../models/EditorController";
import { PageNavigation } from "../models/PageNavigation";
import { History } from "../models/History";
import { createSessionState, snapshotView } from "../models/SessionState";
import { rebuildOccurrence, selectNextOccurrence } from "./selectNextOccurrence";

const disposers: Array<() => void> = [];
function fixture(texts = ["cat + cat", "before CAT", "cat"]) {
	const document = createDocumentState(texts.map((text, index) => ({ id: String(index), text })));
	const session = createSessionState(document.pages);
	const history = new History(document, session);
	const editor = new EditorController(document, session, history, new PageNavigation(document, session));
	disposers.push(() => {
		editor.dispose();
		history.dispose();
	});
	return { document, session, history, editor };
}
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

describe("next occurrence", () => {
	it.each([
		[0, 3, 6, 9],
		[3, 0, 6, 9],
		[6, 9, 0, 3],
	])("immediately extends a selected seed from %s to %s", (anchor, head, nextAnchor, nextHead) => {
		const context = fixture();
		context.session.view = snapshotView({
			...context.session.view,
			selections: { "0": { ranges: [{ anchor, head }], mainIndex: 0, scrollTop: 0 } },
		});
		selectNextOccurrence(context);
		expect(context.session.view.occurrence?.targets.map((target) => target.range)).toEqual([
			{ anchor, head },
			{ anchor: nextAnchor, head: nextHead },
		]);
		expect(context.session.view.occurrence?.steps).toBe(2);
		expect(context.history.canUndo).toBe(false);
	});
	it("keeps one selected occurrence when no successor exists", () => {
		const context = fixture(["cat"]);
		context.session.view = snapshotView({
			...context.session.view,
			selections: { "0": { ranges: [{ anchor: 0, head: 3 }], mainIndex: 0, scrollTop: 0 } },
		});
		selectNextOccurrence(context);
		expect(context.session.view.occurrence?.targets).toHaveLength(1);
		expect(context.session.view.occurrence?.steps).toBe(1);
	});
	it("retains requested selection steps across narrowing and expanding scope", () => {
		const context = fixture(["cat cat", "cat cat cat"]);
		context.session.occurrencePreferences = { matchCase: false, allPages: true };
		for (let index = 0; index < 5; index++) selectNextOccurrence(context);
		context.editor.updateOccurrenceOptions({ allPages: false });
		expect(context.session.view.occurrence?.targets).toHaveLength(2);
		expect(context.session.view.occurrence?.steps).toBe(5);
		context.editor.updateOccurrenceOptions({ allPages: true });
		expect(context.session.view.occurrence?.targets).toHaveLength(5);
	});

	it("preserves an explicit substring seed and finds nonoverlapping successors", () => {
		const context = fixture(["aaaaaa"]);
		context.session.view = snapshotView({
			...context.session.view,
			selections: { "0": { ranges: [{ anchor: 1, head: 3 }], mainIndex: 0, scrollTop: 0 } },
		});
		selectNextOccurrence(context);
		selectNextOccurrence(context);
		context.editor.updateOccurrenceOptions({ matchCase: true });
		expect(context.session.view.occurrence?.targets.map((target) => target.range)).toEqual([
			{ anchor: 1, head: 3 },
			{ anchor: 3, head: 5 },
		]);
	});
	it("seeds a word at an empty cursor and stops after all matches", () => {
		const context = fixture();
		for (let count = 0; count < 5; count++) selectNextOccurrence(context);
		expect(context.session.view.occurrence?.targets.map((target) => target.range)).toEqual([
			{ anchor: 0, head: 3 },
			{ anchor: 6, head: 9 },
		]);
		expect(context.session.view.occurrence?.steps).toBe(2);
		expect(context.history.canUndo).toBe(false);
	});
	it("walks across pages in order, wraps, and does not duplicate ranges", () => {
		const context = fixture();
		context.session.occurrencePreferences = { matchCase: false, allPages: true };
		context.session.view = snapshotView({
			...context.session.view,
			selections: {
				...context.session.view.selections,
				"0": { ranges: [{ anchor: 6, head: 9 }], mainIndex: 0, scrollTop: 0 },
			},
		});
		for (let count = 0; count < 6; count++) selectNextOccurrence(context);
		expect(context.session.view.occurrence?.targets.map((target) => [target.pageId, target.range.anchor])).toEqual([
			["0", 6],
			["1", 7],
			["2", 0],
			["0", 0],
		]);
		expect(context.session.view.occurrence?.primaryTarget).toBe(3);
	});
	it("rebuilds the original seed and step count when scope and case change", () => {
		const context = fixture();
		context.session.occurrencePreferences = { matchCase: false, allPages: true };
		selectNextOccurrence(context);
		selectNextOccurrence(context);
		selectNextOccurrence(context);
		context.editor.updateOccurrenceOptions({ matchCase: true });
		expect(context.session.view.occurrence?.targets.map((target) => target.pageId)).toEqual(["0", "0", "2"]);
		context.editor.updateOccurrenceOptions({ allPages: false });
		expect(context.session.view.occurrence?.targets.map((target) => target.pageId)).toEqual(["0", "0"]);
		expect(context.session.view.activePageId).toBe("0");
	});
	it("keeps remembered off-page selections outside an active edit", () => {
		const context = fixture();
		context.session.view = snapshotView({
			...context.session.view,
			selections: {
				...context.session.view.selections,
				"1": { ranges: [{ anchor: 7, head: 10 }], mainIndex: 0, scrollTop: 0 },
			},
		});
		selectNextOccurrence(context);
		context.editor.apply({ type: "insert", text: "dog" });
		expect(context.document.pages.map((page) => page.text)).toEqual(["dog + cat", "before CAT", "cat"]);
	});
	it("clears exhausted old-seed targets when options change after replacement", () => {
		const context = fixture(["cat", "cat"]);
		context.session.occurrencePreferences = { matchCase: false, allPages: true };
		selectNextOccurrence(context);
		selectNextOccurrence(context);
		context.editor.apply({ type: "insert", text: "dog" });
		context.editor.updateOccurrenceOptions({ matchCase: true });
		expect(context.session.view.occurrence).toBeNull();
		expect(context.document.pages.map((page) => page.text)).toEqual(["dog", "dog"]);
	});
	it("seeds a reversed selection containing emoji and leaves the direction intact", () => {
		const context = fixture(["😀 😀"]);
		context.session.view = snapshotView({
			...context.session.view,
			selections: { "0": { ranges: [{ anchor: 2, head: 0 }], mainIndex: 0, scrollTop: 0 } },
		});
		selectNextOccurrence(context);
		selectNextOccurrence(context);
		expect(context.session.view.occurrence?.targets.map((target) => target.range)).toEqual([
			{ anchor: 2, head: 0 },
			{ anchor: 3, head: 5 },
		]);
	});
	it("does nothing on an empty page or punctuation-only cursor", () => {
		const context = fixture([""]);
		selectNextOccurrence(context);
		rebuildOccurrence(context);
		expect(context.session.view.occurrence).toBeNull();
	});
});
