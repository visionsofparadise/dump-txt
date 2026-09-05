export function normalizeFormFeeds(text: string): string {
	return text
		.replace(/\r\n?/gu, "\n")
		.replace(
			/\f/gu,
			(character, offset: number, source: string) =>
				`${source[offset - 1] === "\n" ? "" : "\n"}${character}${source[offset + 1] === "\n" ? "" : "\n"}`,
		);
}
