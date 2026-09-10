import { describe, expect, it } from "vitest";
import { createDocumentState } from "../models/DocumentState";
import { History } from "../models/History";
import { createSessionState, type TextRange } from "../models/SessionState";
import { prepareEdit } from "./prepareEdit";

function fixture(texts: readonly string[], ranges: readonly TextRange[][], occurrence = true) {
	const document = createDocumentState(texts.map((text, index) => ({ id: `page-${index}`, text })));
	const session = createSessionState(document.pages);
	session.view = {
		activePageId: "page-0",
		selections: Object.fromEntries(
			texts.map((_text, index) => [
				`page-${index}`,
				{ ranges: ranges[index] ?? [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: index * 20 },
			]),
		),
		occurrence: occurrence
			? {
					seed: "x",
					seedPageId: "page-0",
					seedRange: ranges[0]![0]!,
					steps: ranges.flat().length,
					matchCase: false,
					allPages: true,
					targets: ranges.flatMap((pageRanges, index) =>
						pageRanges.map((range) => ({ pageId: `page-${index}`, range })),
					),
					primaryTarget: 0,
				}
			: null,
	};
	const history = new History(document, session);
	return { document, session, history };
}

describe("semantic editing", () => {
	it("replaces different offsets atomically and restores selections and page IDs", () => {
		const { document, session, history } = fixture(
			["x first", "second x"],
			[[{ anchor: 1, head: 0 }], [{ anchor: 7, head: 8 }]],
		);
		const before = document.pages;
		history.commit(prepareEdit({ type: "insert", text: "ok" }, document, session));
		expect(document.pages.map((page) => page.text)).toEqual(["ok first", "second ok"]);
		history.undo();
		expect(document.pages).toBe(before);
		expect(session.view.selections["page-0"]!.ranges).toEqual([{ anchor: 1, head: 0 }]);
		expect(history.canUndo).toBe(false);
	});

	it("does not edit remembered selections on other pages", () => {
		const { document, session } = fixture(
			["first", "second"],
			[[{ anchor: 0, head: 0 }], [{ anchor: 0, head: 6 }]],
			false,
		);
		expect(prepareEdit({ type: "insert", text: "!" }, document, session).pages.map((page) => page.text)).toEqual([
			"!first",
			"second",
		]);
	});

	it("merges overlapping selections before applying the gesture", () => {
		const { document, session } = fixture(
			["abcdef"],
			[
				[
					{ anchor: 1, head: 4 },
					{ anchor: 3, head: 5 },
				],
			],
		);
		expect(prepareEdit({ type: "insert", text: "!" }, document, session).pages[0]!.text).toBe("a!f");
	});

	it.each(["👨‍👩‍👧‍👦", "e\u0301", "😀", "🇬🇧", "👍🏽"])("deletes one complete grapheme %s", (grapheme) => {
		const { document, session } = fixture(
			[`a${grapheme}z`, `a${grapheme}z`],
			[
				[{ anchor: 1 + grapheme.length, head: 1 + grapheme.length }],
				[{ anchor: 1 + grapheme.length, head: 1 + grapheme.length }],
			],
		);
		expect(
			prepareEdit({ type: "delete", direction: "backward" }, document, session).pages.map((page) => page.text),
		).toEqual(["az", "az"]);
	});

	it.each(["👨‍👩‍👧‍👦", "e\u0301", "😀", "🇬🇧", "👍🏽"])("deletes forward across one grapheme %s", (grapheme) => {
		const { document, session } = fixture([`a${grapheme}z`], [[{ anchor: 1, head: 1 }]], false);
		const edit = prepareEdit({ type: "delete", direction: "forward" }, document, session);
		expect(edit.pages[0]!.text).toBe("az");
		expect(edit.after.selections["page-0"]!.ranges).toEqual([{ anchor: 1, head: 1 }]);
	});

	it.each([
		{ text: "", position: 0, direction: "forward", expected: "", cursor: 0 },
		{ text: "", position: 0, direction: "backward", expected: "", cursor: 0 },
		{ text: "a😀", position: 3, direction: "forward", expected: "a😀", cursor: 3 },
		{ text: "ae\u0301z", position: 2, direction: "backward", expected: "a\u0301z", cursor: 1 },
		{ text: "ae\u0301z", position: 2, direction: "forward", expected: "aez", cursor: 2 },
	] as const)(
		"preserves deletion boundaries $direction at $position in $text",
		({ text, position, direction, expected, cursor }) => {
			const { document, session } = fixture([text], [[{ anchor: position, head: position }]], false);
			const edit = prepareEdit({ type: "delete", direction }, document, session);
			expect(edit.pages[0]!.text).toBe(expected);
			expect(edit.after.selections["page-0"]!.ranges).toEqual([{ anchor: cursor, head: cursor }]);
		},
	);

	it("preserves reverse selection and UTF-16 offsets when wrapping the end of a large plain page", () => {
		const prefix = "a".repeat(1024 * 1024);
		const { document, session } = fixture(
			[`${prefix}😀`],
			[[{ anchor: prefix.length + 2, head: prefix.length }]],
			false,
		);
		const edit = prepareEdit({ type: "enclose", opening: "[" }, document, session);
		expect(edit.pages[0]).toEqual({ id: "page-0", text: `${prefix}[😀]` });
		expect(edit.after.selections["page-0"]!.ranges).toEqual([{ anchor: prefix.length + 3, head: prefix.length + 1 }]);
	});

	it("maps a pasted inline separator to the new page after a large plain prefix", () => {
		const prefix = "a".repeat(1024 * 1024);
		const { document, session } = fixture([`${prefix}z`], [[{ anchor: prefix.length, head: prefix.length }]], false);
		const edit = prepareEdit({ type: "paste", text: "\f😀" }, document, session);
		expect(edit.pages.map((page) => page.text)).toEqual([prefix, "😀z"]);
		expect(edit.after.activePageId).toBe(edit.pages[1]!.id);
		expect(edit.after.selections[edit.pages[1]!.id]!.ranges).toEqual([{ anchor: 2, head: 2 }]);
	});

	it("keeps page-edge deletion local", () => {
		const { document, session, history } = fixture(
			["abc", "def"],
			[[{ anchor: 0, head: 0 }], [{ anchor: 0, head: 0 }]],
		);
		expect(
			prepareEdit({ type: "delete", direction: "backward" }, document, session).pages.map((page) => page.text),
		).toEqual(["abc", "def"]);
		const previous = document.pages;
		history.commit(prepareEdit({ type: "delete", direction: "backward" }, document, session));
		expect(document.pages).toBe(previous);
		expect(history.canUndo).toBe(false);
	});

	it("retains the primary occurrence among multiple targets on one page", () => {
		const { document, session } = fixture(
			["cat cat"],
			[
				[
					{ anchor: 0, head: 3 },
					{ anchor: 4, head: 7 },
				],
			],
		);
		session.view = { ...session.view, occurrence: { ...session.view.occurrence!, primaryTarget: 1 } };
		const edit = prepareEdit({ type: "insert", text: "dog" }, document, session);
		expect(edit.after.occurrence?.primaryTarget).toBe(1);
		expect(edit.after.occurrence?.targets[1]?.range).toEqual({ anchor: 7, head: 7 });
	});

	it("wraps reverse selections and keeps their inner text selected", () => {
		const { document, session } = fixture(["hello"], [[{ anchor: 5, head: 0 }]]);
		const edit = prepareEdit({ type: "enclose", opening: "[" }, document, session);
		expect(edit.pages[0]!.text).toBe("[hello]");
		expect(edit.after.selections["page-0"]!.ranges).toEqual([{ anchor: 6, head: 1 }]);
	});

	it("indents touched lines once and excludes a final column-zero line", () => {
		const { document, session } = fixture(["one\ntwo\nthree"], [[{ anchor: 0, head: 8 }]]);
		const edit = prepareEdit({ type: "indent", direction: "in" }, document, session);
		expect(edit.pages[0]!.text).toBe("\tone\n\ttwo\nthree");
	});

	it("outdents an empty first line without touching the next line", () => {
		const { document, session } = fixture(["\n    x"], [[{ anchor: 0, head: 0 }]], false);
		expect(prepareEdit({ type: "indent", direction: "out" }, document, session).pages).toBe(document.pages);
	});

	it("includes the empty first line when indenting a multiline selection", () => {
		const { document, session } = fixture(["\nx"], [[{ anchor: 0, head: 2 }]], false);
		expect(prepareEdit({ type: "indent", direction: "in" }, document, session).pages[0]!.text).toBe("\t\n\tx");
	});

	it("outdents a tab or up to four spaces", () => {
		const { document, session } = fixture(["\tone\n    two\n  three"], [[{ anchor: 0, head: 20 }]]);
		expect(prepareEdit({ type: "indent", direction: "out" }, document, session).pages[0]!.text).toBe(
			"one\ntwo\nthree",
		);
	});

	it("pastes separators at multiple ranges while preserving every suffix", () => {
		const { document, session, history } = fixture(
			["abc def", "ghi"],
			[
				[
					{ anchor: 1, head: 2 },
					{ anchor: 5, head: 6 },
				],
				[{ anchor: 1, head: 2 }],
			],
		);
		history.commit(prepareEdit({ type: "paste", text: "X\fY" }, document, session));
		expect(document.pages.map((page) => page.text)).toEqual(["aX", "Yc dX", "Yf", "gX", "Yi"]);
		expect(document.pages[0]!.id).toBe("page-0");
		expect(document.pages[3]!.id).toBe("page-1");
		history.undo();
		expect(document.pages.map((page) => page.text)).toEqual(["abc def", "ghi"]);
		expect(history.canUndo).toBe(false);
	});

	it("preserves leading, consecutive and trailing empty pasted pages", () => {
		const { document, session } = fixture([""], [[{ anchor: 0, head: 0 }]], false);
		const edit = prepareEdit({ type: "paste", text: "\f\f" }, document, session);
		expect(edit.pages.map((page) => page.text)).toEqual(["", "", ""]);
		expect(edit.after.activePageId).toBe(edit.pages[2]!.id);
	});

	it("replaces all matches in one history entry", () => {
		const { document, session, history } = fixture(["foo foo", "foo"], [[{ anchor: 0, head: 0 }]], false);
		history.commit(
			prepareEdit(
				{
					type: "replace",
					text: "bar",
					matches: [
						{ pageId: "page-0", from: 0, to: 3 },
						{ pageId: "page-0", from: 4, to: 7 },
						{ pageId: "page-1", from: 0, to: 3 },
					],
				},
				document,
				session,
			),
		);
		expect(document.pages.map((page) => page.text)).toEqual(["bar bar", "bar"]);
		history.undo();
		expect(document.pages.map((page) => page.text)).toEqual(["foo foo", "foo"]);
	});

	it("deleting the final page replaces it and undo restores its identity", () => {
		const { document, session, history } = fixture(["last"], [[{ anchor: 4, head: 4 }]], false);
		history.commit(prepareEdit({ type: "deletePage" }, document, session));
		expect(document.pages[0]!.text).toBe("");
		expect(document.pages[0]!.id).not.toBe("page-0");
		history.undo();
		expect(document.pages[0]).toEqual({ id: "page-0", text: "last" });
	});
});
