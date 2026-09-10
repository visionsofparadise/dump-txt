import { findMatches } from "./findMatches";
import type { DumpContext } from "../models/DumpContext";
import type { OccurrenceSession, TextMatch } from "../models/SessionState";

export type OccurrenceSeed = Pick<OccurrenceSession, "seed" | "seedPageId" | "seedRange" | "matchCase" | "allPages">;

export function occurrenceMatchesOf(
	occurrence: OccurrenceSeed,
	context: Pick<DumpContext, "document" | "session">,
): ReadonlyArray<TextMatch> {
	const { document, session } = context;
	const seedFrom = Math.min(occurrence.seedRange.anchor, occurrence.seedRange.head);
	const seedTo = Math.max(occurrence.seedRange.anchor, occurrence.seedRange.head);
	const matchText = (text: string, pageId: string, offset: number) =>
		findMatches(
			{ query: occurrence.seed, matchCase: occurrence.matchCase, allPages: true },
			{ document: { pages: [{ id: pageId, text }] }, session },
		).map((match) => ({ ...match, from: match.from + offset, to: match.to + offset }));

	return document.pages.flatMap((page) => {
		if (!occurrence.allPages && page.id !== occurrence.seedPageId) return [];

		const exact =
			page.id === occurrence.seedPageId &&
			matchText(page.text.slice(seedFrom, seedTo), page.id, seedFrom).some(
				(match) => match.from === seedFrom && match.to === seedTo,
			);

		if (!exact) return matchText(page.text, page.id, 0);

		return [
			...matchText(page.text.slice(0, seedFrom), page.id, 0),
			{ pageId: page.id, from: seedFrom, to: seedTo },
			...matchText(page.text.slice(seedTo), page.id, seedTo),
		];
	});
}
