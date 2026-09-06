import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { selectionStatusOf, textCountsOf } from "./textStatusOf";

describe("text status", () => {
	it("counts Unicode characters, whitespace-separated words, and empty lines", () => {
		expect(textCountsOf("😀 hello\n\nworld")).toEqual({ characters: 14, words: 3, lines: 3 });
		expect(textCountsOf("")).toEqual({ characters: 0, words: 0, lines: 1 });
	});
	it("reports one-based line and character positions", () => {
		const status = selectionStatusOf(Text.of(["😀a", "text"]), [{ anchor: 2, head: 2 }]);

		expect(status.selected).toBe(false);
		expect(status.position).toBe("Ln 1, Col 2");
	});
	it("uses document order for a backwards selection", () => {
		const status = selectionStatusOf(Text.of(["one two", "three"]), [{ anchor: 10, head: 4 }]);

		expect(status.counts).toEqual({ characters: 6, words: 2, lines: 2 });
		expect(status.position).toBe("Ln 1, Col 5 – Ln 2, Col 3");
	});
	it("totals disjoint selections without counting the same line twice", () => {
		const status = selectionStatusOf(Text.of(["one two", "three"]), [
			{ anchor: 7, head: 4 },
			{ anchor: 0, head: 3 },
		]);

		expect(status.counts).toEqual({ characters: 6, words: 2, lines: 1 });
		expect(status.position).toBe("Ln 1, Col 1 – Ln 1, Col 8");
	});
	it("reports the outermost carets while keeping page counts active", () => {
		const status = selectionStatusOf(Text.of(["one", "two"]), [
			{ anchor: 6, head: 6 },
			{ anchor: 1, head: 1 },
		]);

		expect(status.selected).toBe(false);
		expect(status.position).toBe("Ln 1, Col 2 – Ln 2, Col 3");
	});
});
