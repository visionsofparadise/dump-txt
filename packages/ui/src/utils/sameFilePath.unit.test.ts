import { describe, expect, it } from "vitest";
import { sameFilePath } from "./sameFilePath";

describe("native document path comparison", () => {
	it.each([
		["C:\\Notes\\dump.txt", "c:/notes/DUMP.txt", true],
		["\\\\server\\notes\\dump.txt", "\\\\SERVER\\NOTES\\DUMP.txt", true],
		["/home/matt/Foo.txt", "/home/matt/foo.txt", false],
		["/home/matt/notes\\draft.txt", "/home/matt/notes/draft.txt", false],
		["/Users/matt/dump.txt", "/Users/matt/dump.txt", true],
		["C:/notes/dump.txt", "D:/notes/dump.txt", false],
	])("compares %s and %s as %s", (left, right, expected) => {
		expect(sameFilePath(left, right)).toBe(expected);
	});
});
