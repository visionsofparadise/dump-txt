export interface TextFormat {
	readonly encoding: "utf8" | "utf16le" | "utf16be";
	readonly bom: boolean;
	readonly newline: "\n" | "\r\n" | "\r";
}

export function decodeText(bytes: Uint8Array): { text: string; format: TextFormat } {
	if (
		(bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
		(bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
	) {
		throw new Error("UTF-32 files are unsupported. Open a UTF-8 or BOM-marked UTF-16 text file.");
	}

	let encoding: TextFormat["encoding"] = "utf8";
	let offset = 0;

	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
	else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		encoding = "utf16le";
		offset = 2;
	} else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		encoding = "utf16be";
		offset = 2;
	}

	let decoded: string;

	try {
		decoded = new TextDecoder(encoding === "utf8" ? "utf-8" : encoding === "utf16le" ? "utf-16le" : "utf-16be", {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes.subarray(offset));
	} catch {
		throw new Error("This file contains invalid text bytes. Open a UTF-8 or BOM-marked UTF-16 text file.");
	}

	const firstNewline = /\r\n|\r|\n/u.exec(decoded)?.[0];
	const newline = firstNewline === "\r\n" || firstNewline === "\r" ? firstNewline : "\n";

	return { text: decoded.replace(/\r\n?/gu, "\n"), format: { encoding, bom: offset > 0, newline } };
}
