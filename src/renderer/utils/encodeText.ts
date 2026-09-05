import type { TextFormat } from "./decodeText";

export function encodeText(text: string, format: TextFormat): Uint8Array {
	const normalized = text.replace(/\r\n?|\n/gu, format.newline);

	if (format.encoding === "utf8") {
		const payload = new TextEncoder().encode(normalized);

		if (!format.bom) return payload;

		const bytes = new Uint8Array(payload.length + 3);

		bytes.set([0xef, 0xbb, 0xbf]);
		bytes.set(payload, 3);

		return bytes;
	}

	const offset = format.bom ? 2 : 0;
	const bytes = new Uint8Array(normalized.length * 2 + offset);
	const view = new DataView(bytes.buffer);
	const littleEndian = format.encoding === "utf16le";

	if (format.bom) view.setUint16(0, 0xfeff, littleEndian);

	for (let index = 0; index < normalized.length; index++)
		view.setUint16(offset + index * 2, normalized.charCodeAt(index), littleEndian);

	return bytes;
}
