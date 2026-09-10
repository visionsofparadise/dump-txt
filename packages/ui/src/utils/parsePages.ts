import { freezePages, type Page } from "../models/DocumentState";
import { normalizeFormFeeds } from "./normalizeFormFeeds";

export function parsePages(text: string): ReadonlyArray<Page> {
	const normalized = normalizeFormFeeds(text);
	const pages: Array<Page> = [];
	let start = 0;

	for (let index = normalized.indexOf("\f"); index !== -1; index = normalized.indexOf("\f", start)) {
		pages.push({ id: crypto.randomUUID(), text: normalized.slice(start, Math.max(start, index - 1)) });
		start = index + 2;
	}

	pages.push({ id: crypto.randomUUID(), text: normalized.slice(start) });

	return freezePages(pages);
}
