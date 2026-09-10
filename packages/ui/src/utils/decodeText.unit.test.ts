import { describe, expect, it } from "vitest";
import { decodeText, type TextFormat } from "./decodeText";
import { encodeText } from "./encodeText";

describe("text encoding", () => {
	const formats: TextFormat[] = [
		{ encoding: "utf8", bom: false, newline: "\n" },
		{ encoding: "utf8", bom: true, newline: "\r\n" },
		{ encoding: "utf16le", bom: true, newline: "\r" },
		{ encoding: "utf16be", bom: true, newline: "\n" },
	];
	it.each(formats)("preserves $encoding, BOM $bom and newline $newline", (format) => {
		const text = "A😀𝄞é\n\f\n\nlast\n";
		expect(decodeText(encodeText(text, format))).toEqual({ text, format });
	});

	it.each([
		[{ encoding: "utf8", bom: true, newline: "\n" }, [239, 187, 191, 65, 10]],
		[{ encoding: "utf16le", bom: true, newline: "\n" }, [255, 254, 65, 0, 10, 0]],
		[{ encoding: "utf16be", bom: true, newline: "\n" }, [254, 255, 0, 65, 0, 10]],
	] satisfies [TextFormat, number[]][])("writes exact bytes for %j", (format, expected) => {
		expect([...encodeText("A\n", format)]).toEqual(expected);
	});

	it("chooses the first newline and normalizes mixed styles internally", () => {
		expect(decodeText(new TextEncoder().encode("a\rb\r\nc\nd"))).toEqual({
			text: "a\nb\nc\nd",
			format: { encoding: "utf8", bom: false, newline: "\r" },
		});
	});

	it("preserves a content BOM after the encoding marker", () => {
		expect(decodeText(new Uint8Array([239, 187, 191, 239, 187, 191, 65])).text).toBe("\ufeffA");
	});

	it("defaults empty input to UTF-8 and LF", () => {
		expect(decodeText(new Uint8Array())).toEqual({ text: "", format: formats[0] });
	});

	it.each([
		[255, 254, 0, 0],
		[0, 0, 254, 255],
	])("rejects a UTF-32 BOM %j", (...bytes) => {
		expect(() => decodeText(new Uint8Array(bytes))).toThrow("UTF-32");
	});

	it.each([
		[0xc0, 0xaf],
		[0xf0, 0x9f],
		[0xff],
		[0xff, 0xfe, 0x61],
		[0xfe, 0xff, 0xd8, 0x00],
		[0xff, 0xfe, 0x00, 0xdc],
	])("rejects malformed bytes %j", (...bytes) => {
		expect(() => decodeText(new Uint8Array(bytes))).toThrow("invalid text bytes");
	});
});
