import { freezePages, type Page } from "../models/DocumentState";
import { snapshotView, type ViewSnapshot } from "../models/SessionState";

export function persistedPagesOf(
	pages: ReadonlyArray<Page>,
	view: ViewSnapshot,
): { readonly pages: ReadonlyArray<Page>; readonly view: ViewSnapshot } {
	const retained = pages.filter((page) => !page.temporary || page.text !== "");

	if (retained.length === 0) retained.push({ id: view.activePageId, text: "" });

	const index = pages.findIndex((page) => page.id === view.activePageId);
	const fallback = retained[Math.min(Math.max(index, 0), retained.length - 1)];

	if (!fallback) throw new Error("A saved dump requires at least one page.");

	const activePageId = retained.some((page) => page.id === view.activePageId) ? view.activePageId : fallback.id;
	const selections = Object.fromEntries(
		retained.map((page) => [
			page.id,
			view.selections[page.id] ?? { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 },
		]),
	);
	const occurrence =
		view.occurrence &&
		retained.some((page) => page.id === view.occurrence?.seedPageId) &&
		view.occurrence.targets.every((target) => retained.some((page) => page.id === target.pageId))
			? view.occurrence
			: null;

	return { pages: freezePages(retained), view: snapshotView({ activePageId, selections, occurrence }) };
}
