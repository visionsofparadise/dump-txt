import type { DumpContext } from "../models/DumpContext";
import type { FindOptions, TextMatch } from "../models/SessionState";

export function findMatches(
	options: FindOptions,
	context: Pick<DumpContext, "document" | "session">,
): ReadonlyArray<TextMatch> {
	if (!options.query) return [];

	const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const expression = new RegExp(escaped, options.matchCase ? "gu" : "giu");

	return context.document.pages.flatMap((page) => {
		if (!options.allPages && page.id !== context.session.view.activePageId) return [];

		return Array.from(page.text.matchAll(expression), (match) => ({
			pageId: page.id,
			from: match.index,
			to: match.index + match[0].length,
		}));
	});
}
