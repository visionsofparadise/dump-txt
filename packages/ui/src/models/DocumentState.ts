import { createMutableState } from "opshot";
import type { ViewSnapshot } from "./SessionState";

export interface Page {
	readonly id: string;
	readonly text: string;
	readonly temporary?: true;
}

export interface DocumentState {
	pages: ReadonlyArray<Page>;
}

export interface PreparedEdit {
	readonly pages: ReadonlyArray<Page>;
	readonly before: ViewSnapshot;
	readonly after: ViewSnapshot;
	readonly group: string | null;
}

export function freezePages(pages: ReadonlyArray<Page>): ReadonlyArray<Page> {
	if (pages.length === 0) throw new Error("A dump must contain at least one page.");

	const identifiers = new Set<string>();
	const frozen = pages.map((page) => {
		if (!page.id || identifiers.has(page.id)) throw new Error("Page identifiers must be unique.");

		if (page.text.includes("\f")) throw new Error("Form feeds must separate pages.");

		identifiers.add(page.id);

		return Object.isFrozen(page) ? page : Object.freeze({ ...page });
	});

	return Object.isFrozen(pages) && frozen.every((page, index) => page === pages[index])
		? pages
		: Object.freeze(frozen);
}

export function createDocumentState(
	pages: ReadonlyArray<Page> = [{ id: crypto.randomUUID(), text: "" }],
): DocumentState {
	return createMutableState<DocumentState>({ pages: freezePages(pages) });
}
