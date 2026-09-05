import { describe, expect, it } from "vitest";
import { normalizeFormFeeds } from "./normalizeFormFeeds";
import { parsePages } from "./parsePages";
import { serializePages } from "./serializePages";

describe("form-feed pages", () => {
	it.each([
		["", [""]],
		["alpha", ["alpha"]],
		["a\fb", ["a", "b"]],
		["a\n\f\nb", ["a", "b"]],
		["\f", ["", ""]],
		["\f\f", ["", "", ""]],
		["\n\f\n\f\n", ["", "", ""]],
		["a\n\f\n\f\nb", ["a", "", "b"]],
		["\fa\f", ["", "a", ""]],
		["a\n\n\f\n\nb\n", ["a\n", "\nb\n"]],
		["a\r\n\f\r\nb", ["a", "b"]],
		["a\r\f\rb", ["a", "b"]],
		["😀\f𝄞", ["😀", "𝄞"]],
	])("preserves the page texts in %j", (input, texts) => {
		const pages = parsePages(input);
		expect(pages.map((page) => page.text)).toEqual(texts);
		expect(new Set(pages.map((page) => page.id)).size).toBe(pages.length);
		expect(Object.isFrozen(pages)).toBe(true);
		expect(pages.every(Object.isFrozen)).toBe(true);
		const canonical = serializePages(pages);
		expect(serializePages(parsePages(canonical))).toBe(canonical);
		expect(normalizeFormFeeds(normalizeFormFeeds(input))).toBe(normalizeFormFeeds(input));
	});

	it("expands a shared separator newline without consuming extra whitespace", () => {
		expect(serializePages(parsePages("a\n\f\n\f\nb"))).toBe("a\n\f\n\n\f\nb");
		expect(serializePages(parsePages("\n\f\n\f\n"))).toBe("\n\f\n\n\f\n");
	});

	it("round trips independently allocated page identifiers", () => {
		const pages = ["", "\n", "hello\n", "\n\nworld", "", "😀"].map((text, index) => ({ id: String(index), text }));
		expect(parsePages(serializePages(pages)).map((page) => page.text)).toEqual(pages.map((page) => page.text));
	});
});
