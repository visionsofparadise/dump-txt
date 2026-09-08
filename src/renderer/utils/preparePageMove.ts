import { freezePages, type DocumentState, type PreparedEdit } from "../models/DocumentState";
import { snapshotView, type SessionState } from "../models/SessionState";

export function preparePageMove(
	direction: "up" | "down",
	document: DocumentState,
	session: SessionState,
): PreparedEdit {
	const before = snapshotView(session.view);
	const pages = [...document.pages];
	const index = pages.findIndex((page) => page.id === before.activePageId);
	const page = pages[index];

	if (!page) throw new Error("Page movement requires a current page.");

	const destination = index + (direction === "up" ? -1 : 1);
	const neighbor = pages[destination];
	const selections = { ...before.selections };
	const retained = { id: page.id, text: page.text };

	if (neighbor) {
		pages[index] = { id: neighbor.id, text: neighbor.text };
		pages[destination] = retained;
	} else {
		const blank = { id: crypto.randomUUID(), text: "" };

		pages[index] = retained;
		pages.splice(index + (direction === "up" ? 1 : 0), 0, blank);
		selections[blank.id] = { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 };
	}

	return {
		pages: freezePages(pages),
		before,
		after: snapshotView({ ...before, selections, occurrence: null }),
		group: null,
	};
}
