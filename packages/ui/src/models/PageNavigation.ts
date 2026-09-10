import { flush } from "opshot";
import { freezePages, type DocumentState } from "./DocumentState";
import { snapshotView, type SessionState } from "./SessionState";

export type PageEntry = "restore" | "start" | "end";

export class PageNavigation {
	readonly #document: DocumentState;
	readonly #session: SessionState;
	readonly #listeners = new Set<(entry: PageEntry) => void>();
	#locked = false;
	#cleanupPending = false;

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

		this.#activate(pageId);
	}

	navigate(direction: -1 | 1 | "first" | "last", entry: PageEntry = "restore"): boolean {
		if (this.#locked) return true;

		const pages = this.#document.pages;
		const current = pages.findIndex((page) => page.id === this.#session.view.activePageId);
		const index = direction === "first" ? 0 : direction === "last" ? pages.length - 1 : current + direction;
		const page = pages[index];

		if (page) this.show(page.id, entry);
		else if (direction === -1 || direction === 1) {
			for (const listener of this.#listeners) listener(entry);

			const settled = this.#document.pages;
			const active = settled.findIndex((candidate) => candidate.id === this.#session.view.activePageId);
			const currentPage = settled[active];
			const adjacent = settled[active + direction];

			if (adjacent) {
				this.#activate(adjacent.id);

				return true;
			}

			if (!currentPage || (currentPage.temporary && currentPage.text === "")) return true;

			const created = { id: crypto.randomUUID(), text: "", temporary: true as const };

			this.#document.pages = freezePages(direction < 0 ? [created, ...settled] : [...settled, created]);
			this.#activate(created.id);
			flush(this.#document);
		}

		return true;
	}

	#activate(pageId: string): void {
		if (!this.#document.pages.some((page) => page.id === pageId)) return;

		this.#session.view = snapshotView({ ...this.#session.view, activePageId: pageId });
		flush(this.#session);
		this.discardUnusedPages();
	}

	scheduleCleanup(): void {
		if (this.#cleanupPending) return;

		this.#cleanupPending = true;
		queueMicrotask(() => {
			this.#cleanupPending = false;
			this.discardUnusedPages();
		});
	}

	discardUnusedPages(): void {
		const activePageId = this.#session.view.activePageId;
		const pages = this.#document.pages.filter(
			(page) => page.id === activePageId || !page.temporary || page.text !== "",
		);

		if (
			pages.length === this.#document.pages.length &&
			Object.keys(this.#session.view.selections).every((id) => pages.some((page) => page.id === id))
		)
			return;

		const selections = Object.fromEntries(
			Object.entries(this.#session.view.selections).filter(([id]) => pages.some((page) => page.id === id)),
		);

		this.#document.pages = freezePages(pages);
		this.#session.view = snapshotView({ ...this.#session.view, selections });
		flush(this.#document);
		flush(this.#session);
	}

	handleWheel(event: WheelEvent): void {
		const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);

		if (event.ctrlKey || delta === 0) return;

		event.preventDefault();
		this.navigate(delta > 0 ? 1 : -1);
	}
}
