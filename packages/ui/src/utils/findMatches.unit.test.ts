import { describe, expect, it } from "vitest";
import { createDocumentState } from "../models/DocumentState";
import { createSessionState } from "../models/SessionState";
import { findMatches } from "./findMatches";

function fixture(texts = ["Cat cat", "x CAT"]) {
	const document = createDocumentState(texts.map((text, index) => ({ id: String(index), text })));
	return { document, session: createSessionState(document.pages) };
}

describe("literal page matching", () => {
	it("uses independent page offsets and the current-page default", () => {
		const context = fixture();
		expect(findMatches({ query: "cat", matchCase: false, allPages: false }, context)).toEqual([
			{ pageId: "0", from: 0, to: 3 },
			{ pageId: "0", from: 4, to: 7 },
		]);
		expect(findMatches({ query: "cat", matchCase: false, allPages: true }, context).at(-1)).toEqual({
			pageId: "1",
			from: 2,
			to: 5,
		});
	});
	it("respects match case", () => {
		expect(findMatches({ query: "cat", matchCase: true, allPages: true }, fixture())).toEqual([
			{ pageId: "0", from: 4, to: 7 },
		]);
	});
	it.each(["", "absent"])("returns no matches for %j", (query) => {
		expect(findMatches({ query, matchCase: false, allPages: true }, fixture())).toEqual([]);
	});
	it("escapes regex punctuation literally", () => {
		expect(findMatches({ query: "[a].*", matchCase: false, allPages: true }, fixture(["[a].* [A].* aa"]))).toEqual([
			{ pageId: "0", from: 0, to: 5 },
			{ pageId: "0", from: 6, to: 11 },
		]);
	});
	it("retains original UTF-16 offsets for emoji and combining marks", () => {
		const context = fixture(["😀e\u0301😀E\u0301"]);
		expect(findMatches({ query: "e\u0301", matchCase: false, allPages: true }, context)).toEqual([
			{ pageId: "0", from: 2, to: 4 },
			{ pageId: "0", from: 6, to: 8 },
		]);
		expect(
			findMatches({ query: "😀", matchCase: false, allPages: true }, context).map((match) => [match.from, match.to]),
		).toEqual([
			[0, 2],
			[4, 6],
		]);
	});
	it("uses Unicode case folding without rewriting the source", () => {
		expect(
			findMatches({ query: "k", matchCase: false, allPages: true }, fixture(["K K k"])).map((match) => match.from),
		).toEqual([0, 2, 4]);
	});
	it("keeps matches nonoverlapping and inside individual pages", () => {
		expect(findMatches({ query: "aa", matchCase: true, allPages: true }, fixture(["aaa", "a"]))).toEqual([
			{ pageId: "0", from: 0, to: 2 },
		]);
		expect(findMatches({ query: "a\na", matchCase: true, allPages: true }, fixture(["a", "a"]))).toEqual([]);
	});
});
