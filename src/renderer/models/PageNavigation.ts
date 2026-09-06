import { flush } from "opshot";
import { snapshotView, type SessionState } from "./SessionState";
import type { DocumentState } from "./DocumentState";

export type PageEntry = "restore" | "start" | "end";

export class PageNavigation {
	readonly #document: DocumentState;
	readonly #session: SessionState;
	readonly #listeners = new Set<(entry: PageEntry) => void>();
	#locked = false;

	constructor(document: DocumentState, session: SessionState) {
		this.#document = document;
		this.#session = session;
	}

	setLocked(locked: boolean): void {
		this.#locked = locked;
	}

	subscribeBeforeChange(listener: (entry: PageEntry) => void): () => void {
		this.#listeners.add(listener);

		return () => this.#listeners.delete(listener);
	}

	show(pageId: string, entry: PageEntry = "restore"): void {
		if (this.#locked || pageId === this.#session.view.activePageId) return;
		if (!this.#document.pages.some((page) => page.id === pageId)) return;

		for (const listener of this.#listeners) listener(entry);

		this.#session.view = snapshotView({ ...this.#session.view, activePageId: pageId });
		flush(this.#session);
	}

	navigate(direction: -1 | 1 | "first" | "last"): boolean {
		const pages = this.#document.pages;
		const current = pages.findIndex((page) => page.id === this.#session.view.activePageId);
		const index = direction === "first" ? 0 : direction === "last" ? pages.length - 1 : current + direction;
		const page = pages[index];

		if (page) this.show(page.id);

		return true;
	}

	handleWheel(event: WheelEvent): void {
		const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);

		if (event.ctrlKey || delta === 0) return;

		event.preventDefault();
		this.navigate(delta > 0 ? 1 : -1);
	}
}
