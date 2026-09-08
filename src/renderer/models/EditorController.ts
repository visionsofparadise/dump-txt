import { defaultKeymap } from "@codemirror/commands";
import { ChangeSet, Compartment, EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { flush, subscribe } from "opshot";
import { createOccurrenceHighlights, refreshOccurrenceHighlights } from "../utils/createOccurrenceHighlights";
import { findMatches } from "../utils/findMatches";
import { participatingRanges, prepareChanges, prepareEdit } from "../utils/prepareEdit";
import { rebuildOccurrence, selectNextOccurrence } from "../utils/selectNextOccurrence";
import { textChangeOf } from "../utils/textChangeOf";
import { snapshotView, type SessionState, type TextMatch, type ViewSnapshot } from "./SessionState";
import type { DocumentState, Page } from "./DocumentState";
import type { EditCommand } from "./EditCommand";
import type { History } from "./History";
import type { PageNavigation } from "./PageNavigation";
import type { TextContextMenuResponse, TextContextMenuState } from "./TextContextMenuState";

interface EditorCallbacks {
	readonly openFind?: () => void;
	readonly selectNextOccurrence?: () => void;
	readonly changed?: () => void;
	readonly showTextContextMenu?: (state: TextContextMenuState) => Promise<TextContextMenuResponse>;
	readonly readClipboard?: () => Promise<string>;
	readonly writeClipboard?: (text: string) => Promise<void>;
}

interface Composition {
	readonly pages: ReadonlyArray<Page>;
	readonly view: ViewSnapshot;
	readonly state: EditorState;
	latest: EditorState;
	changes: ChangeSet;
}

export interface PageSnapshot {
	readonly dom: HTMLElement;
	readonly scrollTop: number;
}

export interface PageTransition {
	readonly id: string;
	readonly direction: -1 | 1;
	readonly outgoing: PageSnapshot;
	readonly incoming: PageSnapshot | null;
}

export class EditorController {
	readonly #document: DocumentState;
	readonly #session: SessionState;
	readonly #history: History;
	readonly #navigation: PageNavigation;
	readonly #callbacks: EditorCallbacks;
	readonly #states = new Map<string, EditorState>();
	readonly #scrollSnapshots = new Map<
		string,
		{ readonly state: EditorState; readonly effect: ReturnType<EditorView["scrollSnapshot"]> }
	>();
	readonly #transitionListeners = new Set<(transition: PageTransition | null) => void>();
	readonly #editable = new Compartment();
	readonly #unsubscribers: ReadonlyArray<() => void>;
	#view: EditorView | null = null;
	#pageId: string;
	#updating = false;
	#locked = false;
	#composition: Composition | null = null;
	#menuGeneration = 0;
	#menuSelection: string | null = null;
	#transition: PageTransition | null = null;
	#restoring = false;
	#measurement = 0;
	#entry: "restore" | "start" | "end" = "restore";
	#wheelAt = -Infinity;
	#wheelDirection = 0;
	#wheelDistance = 0;
	#overscrollTimer: ReturnType<typeof setTimeout> | null = null;
	#wheelConsumed = false;
	#pendingWheelDelta = 0;
	#smoothWheelTarget: number | null = null;
	#smoothWheelDirection = 0;
	#wheelFrame: number | null = null;
	readonly #resize = () => {
		this.#resetOverscroll();
		this.#cancelWheelScroll();
		this.#cancelTransition();
		this.#restoreScroll("restore");
	};

	constructor(
		document: DocumentState,
		session: SessionState,
		history: History,
		navigation: PageNavigation,
		callbacks: EditorCallbacks = {},
	) {
		this.#document = document;
		this.#session = session;
		this.#history = history;
		this.#navigation = navigation;
		this.#callbacks = callbacks;
		this.#pageId = session.view.activePageId;
		this.#unsubscribers = [
			navigation.subscribeBeforeChange((entry) => {
				this.#menuGeneration++;
				this.finishComposition();
				this.#rememberSelection();
				this.#history.closeGroup();
				this.#entry = entry;
			}),
			subscribe(document, () => {
				this.#menuGeneration++;
				this.refresh();
			}),
			subscribe(session, () => this.refresh()),
		];
	}

	attach(parent: HTMLElement): void {
		this.detach();
		this.#pageId = this.#session.view.activePageId;
		this.#view = new EditorView({
			parent,
			state: this.#stateFor(this.#pageId),
			dispatchTransactions: (transactions, view) => this.dispatch(transactions, view),
		});
		window.addEventListener("resize", this.#resize);
		this.#restoring = false;

		this.#restoreScroll("restore");
	}

	detach(): void {
		this.#resetOverscroll();
		this.#menuGeneration++;
		this.#cancelWheelScroll();
		this.finishComposition();
		this.#cancelTransition();
		this.#measurement++;

		if (this.#view) {
			window.removeEventListener("resize", this.#resize);
			this.#rememberSelection();
			this.#states.set(this.#pageId, this.#view.state);
			this.#view.destroy();
			this.#view = null;
		}
	}

	dispose(): void {
		this.detach();

		for (const unsubscribe of this.#unsubscribers) unsubscribe();

		this.#states.clear();
		this.#scrollSnapshots.clear();
		this.#transitionListeners.clear();
	}

	focus(): void {
		this.#view?.focus();
	}

	revealSelection(): void {
		this.#measurement++;
		this.#restoring = false;
		this.#cancelTransition();

		if (this.#view)
			this.#view.dispatch({
				effects: EditorView.scrollIntoView(this.#view.state.selection.main.head, { y: "nearest" }),
			});
	}

	selectNextOccurrence(): void {
		if (this.#locked) return;

		this.finishComposition();
		this.#session.find = { ...this.#session.find, open: false };
		selectNextOccurrence({ document: this.#document, session: this.#session, history: this.#history, editor: this });
	}

	closeOccurrence(): void {
		if (this.#locked) return;

		this.#endOccurrence(true);
		this.focus();
	}

	updateOccurrenceOptions(options: Partial<SessionState["occurrencePreferences"]>): void {
		if (this.#locked) return;

		this.#history.closeGroup();
		this.#session.occurrencePreferences = { ...this.#session.occurrencePreferences, ...options };
		rebuildOccurrence({ document: this.#document, session: this.#session, history: this.#history, editor: this });
	}

	openFind(): void {
		if (this.#locked) return;

		this.finishComposition();
		this.#history.closeGroup();

		const selection = this.#session.view.selections[this.#session.view.activePageId];
		const range = selection?.ranges[selection.mainIndex];
		const text = this.#document.pages.find((page) => page.id === this.#session.view.activePageId)?.text ?? "";
		const query =
			range && range.anchor !== range.head
				? text.slice(Math.min(range.anchor, range.head), Math.max(range.anchor, range.head))
				: this.#session.find.query;

		this.#endOccurrence(true);
		this.#session.find = { ...this.#session.find, open: true, query, activeMatch: -1 };
		this.nextFind(1);
	}

	closeFind(): void {
		this.#session.find = { ...this.#session.find, open: false };
		this.#history.closeGroup();
		this.focus();
	}

	updateFind(options: Partial<Pick<SessionState["find"], "query" | "replacement" | "matchCase" | "allPages">>): void {
		if (this.#locked) return;

		this.#history.closeGroup();

		const searchChanged =
			options.query !== undefined || options.matchCase !== undefined || options.allPages !== undefined;

		this.#session.find = {
			...this.#session.find,
			...options,
			activeMatch: searchChanged ? -1 : this.#session.find.activeMatch,
		};

		if (searchChanged) this.nextFind(1);
	}

	nextFind(direction: 1 | -1): void {
		if (this.#locked) return;

		this.#history.closeGroup();

		const matches = findMatches(this.#session.find, { document: this.#document, session: this.#session });

		if (matches.length === 0) {
			this.#session.find = { ...this.#session.find, activeMatch: -1 };

			return;
		}

		const previous = this.#session.find.activeMatch >= 0 ? this.#selectedFindIndex(matches) : -1;
		let index: number;

		if (previous >= 0 && previous < matches.length) index = (previous + direction + matches.length) % matches.length;
		else {
			const activePage = this.#document.pages.findIndex((page) => page.id === this.#session.view.activePageId);
			const selection = this.#session.view.selections[this.#session.view.activePageId];
			const range = selection?.ranges[selection.mainIndex];
			const from = range ? Math.min(range.anchor, range.head) : 0;

			index = matches.findIndex((match) => {
				const pageIndex = this.#document.pages.findIndex((page) => page.id === match.pageId);

				return pageIndex > activePage || (pageIndex === activePage && match.from >= from);
			});

			if (index === -1) index = 0;

			if (direction === -1) index = (index - 1 + matches.length) % matches.length;
		}

		const match = matches[index];

		if (!match) return;

		this.#session.find = { ...this.#session.find, activeMatch: index };
		this.#session.view = snapshotView({
			...this.#session.view,
			activePageId: match.pageId,
			occurrence: null,
			selections: {
				...this.#session.view.selections,
				[match.pageId]: {
					ranges: [{ anchor: match.from, head: match.to }],
					mainIndex: 0,
					scrollTop: this.#session.view.selections[match.pageId]?.scrollTop ?? 0,
				},
			},
		});
		flush(this.#session);
		this.refresh();
		this.revealSelection();
	}

	replaceFind(all: boolean): void {
		if (this.#locked) return;

		const matches = findMatches(this.#session.find, { document: this.#document, session: this.#session });

		if (!all && this.#selectedFindIndex(matches) === -1) {
			this.#session.find = { ...this.#session.find, activeMatch: -1 };
			this.nextFind(1);
		}

		const selected = matches[this.#selectedFindIndex(matches)];
		const replacements = all ? matches : selected ? [selected] : [];

		if (replacements.length === 0) return;

		this.apply({ type: "replace", matches: replacements, text: this.#session.find.replacement });
		this.#session.find = { ...this.#session.find, activeMatch: -1 };
		this.nextFind(1);
	}

	setLocked(locked: boolean): void {
		this.#menuGeneration++;

		if (locked) {
			this.#resetOverscroll();
			this.#cancelWheelScroll();
			this.finishComposition();
		}

		this.#locked = locked;
		this.#navigation.setLocked(locked);
		this.#view?.dispatch({
			effects: this.#editable.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
		});
	}

	showPage(pageId: string, entry: "restore" | "start" | "end" = "restore"): void {
		this.#navigation.show(pageId, entry);
		this.focus();
	}

	subscribePageTransition(listener: (transition: PageTransition | null) => void): () => void {
		this.#transitionListeners.add(listener);

		return () => {
			this.#transitionListeners.delete(listener);
		};
	}

	finishPageTransition(id: string): void {
		if (this.#transition?.id !== id) return;

		this.#cancelTransition();
		this.#applyPendingWheel();
	}

	handleWheel(event: WheelEvent): void {
		const view = this.#view;
		const wheelDelta = event.shiftKey && event.deltaY === 0 ? event.deltaX : event.deltaY;

		if (!view || wheelDelta === 0) return;

		const lineHeight =
			Number.parseFloat(window.getComputedStyle(view.contentDOM).lineHeight) || view.defaultLineHeight;
		const delta =
			wheelDelta * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? view.scrollDOM.clientHeight : 1);

		if (event.ctrlKey) {
			event.preventDefault();

			if (!this.#locked && !this.#composition) this.#resizeText(delta < 0 ? 1 : -1, event);

			return;
		}

		if (this.#locked || this.#composition) return;

		const wheelTicks =
			"wheelDeltaY" in event && typeof event.wheelDeltaY === "number" && event.wheelDeltaY !== 0
				? -event.wheelDeltaY / 120
				: event.deltaMode === 1
					? event.deltaY / 3
					: Math.sign(delta);
		const scrollDelta = wheelTicks * 3 * lineHeight;
		const now = performance.now();
		const direction = delta > 0 ? 1 : -1;
		const gap = now - this.#wheelAt;
		const reversed = direction !== this.#wheelDirection;

		if (gap >= 300 || reversed) this.#wheelConsumed = false;

		if (gap >= 250 || reversed) this.#resetOverscroll();

		this.#wheelAt = now;
		this.#wheelDirection = direction;

		if (this.#restoring || this.#transition) {
			event.preventDefault();
			this.#pendingWheelDelta += scrollDelta;

			return;
		}

		const atEdge =
			direction < 0
				? view.scrollDOM.scrollTop <= 1
				: view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >= view.scrollDOM.scrollHeight - 1;

		if (!atEdge) {
			event.preventDefault();
			this.#resetOverscroll();
			this.#wheelConsumed = false;
			this.#cancelTransition();
			this.#scrollWheel(scrollDelta);

			return;
		}

		event.preventDefault();

		if (this.#wheelConsumed) return;

		this.#wheelDistance += Math.abs(delta);
		view.dom.style.setProperty(
			direction < 0 ? "--overscroll-top" : "--overscroll-bottom",
			`${Math.min(1, this.#wheelDistance / 300) * 100}%`,
		);

		if (this.#overscrollTimer) clearTimeout(this.#overscrollTimer);

		this.#overscrollTimer = setTimeout(() => this.#resetOverscroll(), 250);

		if (this.#wheelDistance < 300) return;

		this.#wheelConsumed = true;
		this.#navigation.navigate(direction, direction > 0 ? "start" : "end");
	}

	#resetOverscroll(): void {
		if (this.#overscrollTimer) clearTimeout(this.#overscrollTimer);

		this.#overscrollTimer = null;
		this.#wheelDistance = 0;
		this.#view?.dom.style.removeProperty("--overscroll-top");
		this.#view?.dom.style.removeProperty("--overscroll-bottom");
	}

	refresh(): void {
		if (this.#menuSelection !== null && this.#menuSelection !== this.#selectionOfMenu()) {
			this.#menuGeneration++;
			this.#menuSelection = null;
		}

		if (this.#updating || this.#composition) return;

		this.#synchronizeFind();

		if (!this.#view) return;

		const pageId = this.#session.view.activePageId;
		const page = this.#document.pages.find((candidate) => candidate.id === pageId);

		if (!page) return;

		this.#updating = true;

		try {
			const selection = this.#selectionFor(pageId, page.text.length);

			if (this.#pageId !== pageId) {
				this.#cancelTransition();
				this.#beginTransition(pageId);
				this.#resetOverscroll();

				this.#states.set(this.#pageId, this.#view.state);
				this.#pageId = pageId;
				this.#view.setState(this.#stateFor(pageId));
				this.#restoreScroll(this.#entry);
				this.#entry = "restore";
			} else if (this.#view.state.doc.toString() !== page.text) {
				this.#cancelTransition();
				this.#cancelWheelScroll();
				this.#measurement++;
				this.#restoring = false;
				this.#view.dispatch({
					changes: textChangeOf(this.#view.state.doc.toString(), page.text),
					selection,
				});
			} else if (!this.#view.state.selection.eq(selection)) {
				this.#cancelTransition();
				this.#view.dispatch({ selection });
			}

			for (const cachedId of this.#states.keys())
				if (!this.#document.pages.some((candidate) => candidate.id === cachedId)) {
					this.#states.delete(cachedId);
					this.#scrollSnapshots.delete(cachedId);
				}

			for (const id of Object.keys(this.#history.scroll.positions))
				if (!this.#document.pages.some((candidate) => candidate.id === id))
					Reflect.deleteProperty(this.#history.scroll.positions, id);

			this.#view.dispatch({ effects: refreshOccurrenceHighlights.of() });
		} finally {
			this.#updating = false;
		}

		this.#navigation.scheduleCleanup();
	}

	apply(command: EditCommand): void {
		if (this.#locked) return;

		this.#cancelTransition();

		this.finishComposition();
		this.#rememberSelection();
		this.#history.closeGroup();
		this.#history.commit(prepareEdit(command, this.#document, this.#session));
		this.refresh();

		if (command.type === "movePage") {
			this.#beginTransition(this.#pageId, command.direction === "up" ? 1 : -1);
			this.#restoreScroll("restore");
		}

		this.#callbacks.changed?.();
	}

	dispatch(transactions: ReadonlyArray<Transaction>, view: EditorView): void {
		if (this.#locked && transactions.some((transaction) => transaction.docChanged)) return;

		if (this.#updating) {
			view.update(transactions);

			return;
		}

		if (transactions.some((transaction) => transaction.docChanged || transaction.selection)) {
			this.rememberScroll();
			this.#menuGeneration++;
			this.#cancelWheelScroll();
			this.#cancelTransition();
			this.#measurement++;
			this.#restoring = false;
		}

		this.#updating = true;

		try {
			for (const transaction of transactions) {
				view.update([transaction]);

				if (this.#composition) {
					this.#composition.latest = transaction.state;
					this.#composition.changes = this.#composition.changes.compose(transaction.changes);

					continue;
				}

				if (!transaction.docChanged) {
					if (transaction.selection) {
						this.#endOccurrence(false);
						this.#rememberSelection();
						this.#history.closeGroup();
					}

					continue;
				}

				const changes: Array<{ from: number; to: number; insert: string }> = [];

				transaction.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) =>
					changes.push({ from, to, insert: inserted.toString() }),
				);

				const isTyping = transaction.isUserEvent("input.type");
				const isDeletion = transaction.isUserEvent("delete");
				const group =
					isTyping || isDeletion
						? `${isTyping ? "typing" : "delete"}:${[...participatingRanges(this.#document, this.#session.view)].map(([pageId, ranges]) => `${pageId}:${ranges.length}`).join(",")}`
						: null;

				if (this.#session.view.occurrence) {
					const first = changes[0];

					if (first) {
						const command: EditCommand = first.insert
							? { type: "insert", text: first.insert }
							: {
									type: "delete",
									direction: transaction.isUserEvent("delete.forward") ? "forward" : "backward",
								};

						this.#history.commit({ ...prepareEdit(command, this.#document, this.#session), group });
					}
				} else {
					this.#history.commit(
						prepareChanges(
							[
								{
									pageId: this.#pageId,
									changes,
									ranges: transaction.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
								},
							],
							this.#document,
							this.#session,
							group,
						),
					);
				}

				this.#callbacks.changed?.();
			}
		} finally {
			this.#updating = false;
		}

		this.refresh();
	}

	finishComposition(): void {
		const composition = this.#composition;

		if (!composition) return;

		this.#composition = null;

		const before = composition.state.doc.toString();
		const after = composition.latest.doc.toString();

		if (before !== after) {
			const document = { pages: composition.pages };
			const session = { ...this.#session, view: composition.view };
			const primary = composition.state.selection.main;
			const composedText = after.slice(
				composition.changes.mapPos(primary.from, -1),
				composition.changes.mapPos(primary.to, 1),
			);
			const changes: Array<{ from: number; to: number; insert: string }> = [];

			composition.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) =>
				changes.push({ from, to, insert: inserted.toString() }),
			);

			const edit = composition.view.occurrence
				? prepareEdit({ type: "insert", text: composedText }, document, session)
				: prepareChanges(
						[
							{
								pageId: composition.view.activePageId,
								changes,
								ranges: composition.latest.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
							},
						],
						document,
						session,
					);

			this.#history.closeGroup();
			this.#history.commit(edit);
			this.#callbacks.changed?.();
		}

		this.#history.closeGroup();
		this.refresh();
	}

	#beginTransition(pageId: string, direction?: -1 | 1): void {
		const view = this.#view;

		if (!view) return;

		if (!this.#restoring)
			this.#scrollSnapshots.set(this.#pageId, { state: view.state, effect: view.scrollSnapshot() });

		const current = this.#document.pages.findIndex((page) => page.id === this.#pageId);
		const target = this.#document.pages.findIndex((page) => page.id === pageId);

		this.#transition = {
			id: crypto.randomUUID(),
			direction: direction ?? (target >= current ? 1 : -1),
			outgoing: this.#captureSnapshot(view),
			incoming: null,
		};
		view.dom.parentElement?.classList.add("page-editor-covered");
		this.#publishTransition();
	}

	#captureSnapshot(view: EditorView): PageSnapshot {
		const dom = view.dom.cloneNode(true);

		if (!(dom instanceof HTMLElement)) throw new Error("Editor snapshot is not an HTML element");

		dom.classList.remove("page-editor-covered");
		dom.inert = true;
		dom.removeAttribute("id");

		for (const element of dom.querySelectorAll("[id], [contenteditable], [tabindex], [autofocus]")) {
			element.removeAttribute("id");
			element.removeAttribute("autofocus");
			element.removeAttribute("tabindex");

			if (element.hasAttribute("contenteditable")) element.setAttribute("contenteditable", "false");
		}

		return { dom, scrollTop: view.scrollDOM.scrollTop };
	}

	#publishTransition(): void {
		for (const listener of this.#transitionListeners) listener(this.#transition);
	}

	#cancelTransition(): void {
		if (!this.#transition) return;

		this.#transition = null;
		this.#view?.dom.parentElement?.classList.remove("page-editor-covered");
		this.#publishTransition();
	}

	#pageMargin(view: EditorView): number {
		return Math.max(0, Number.parseFloat(getComputedStyle(view.contentDOM).paddingTop) - 10) || 0;
	}

	#restoreScroll(entry: "restore" | "start" | "end"): void {
		const view = this.#view;

		if (!view) return;

		const measurement = ++this.#measurement;
		const remembered =
			this.#history.scroll.positions[this.#pageId] ?? this.#session.view.selections[this.#pageId]?.scrollTop ?? 0;
		const cached = this.#scrollSnapshots.get(this.#pageId);
		const snapshot = entry === "restore" && cached?.state.doc === view.state.doc ? cached.effect : null;

		this.#restoring = true;
		this.#pendingWheelDelta = 0;
		this.#cancelWheelScroll();

		if (snapshot) view.dispatch({ effects: snapshot });
		else if (entry !== "restore")
			view.dispatch({
				effects: EditorView.scrollIntoView(entry === "start" ? 0 : view.state.doc.length, { y: entry, yMargin: 0 }),
			});

		view.requestMeasure({
			read: () => null,
			write: () => {
				if (measurement !== this.#measurement || view !== this.#view) return;

				if (!snapshot && entry === "restore") view.scrollDOM.scrollTop = remembered + this.#pageMargin(view);

				requestAnimationFrame(() => {
					if (measurement !== this.#measurement || view !== this.#view) return;

					this.#settleScroll(view, measurement, entry, remembered);
				});
			},
		});
	}

	#settleScroll(view: EditorView, measurement: number, entry: "restore" | "start" | "end", remembered: number): void {
		view.requestMeasure({
			read: () => ({
				top:
					entry === "end"
						? view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight
						: entry === "start"
							? this.#pageMargin(view)
							: Math.max(
									0,
									Math.min(
										remembered + this.#pageMargin(view),
										Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight),
									),
								),
			}),
			write: ({ top }) => {
				if (measurement !== this.#measurement || view !== this.#view) return;

				requestAnimationFrame(() => {
					if (measurement !== this.#measurement || view !== this.#view) return;

					view.scrollDOM.scrollTop = top;
					view.requestMeasure({
						read: () => this.#captureSnapshot(view),
						write: (incoming) => {
							if (measurement !== this.#measurement || view !== this.#view) return;

							this.#restoring = false;

							if (!this.#transition) this.#applyPendingWheel();

							this.#rememberSelection();

							if (this.#transition) {
								this.#transition = { ...this.#transition, incoming };
								this.#publishTransition();
							}
						},
					});
				});
			},
		});
	}

	#applyPendingWheel(): void {
		if (!this.#view || this.#pendingWheelDelta === 0) return;

		this.#scrollWheel(this.#pendingWheelDelta);
		this.#pendingWheelDelta = 0;
		this.#wheelConsumed = false;
		this.#rememberSelection();
	}

	#scrollWheel(delta: number): void {
		const view = this.#view;

		if (!view) return;

		const scroller = view.scrollDOM;
		const lineHeight =
			Number.parseFloat(window.getComputedStyle(view.contentDOM).lineHeight) || view.defaultLineHeight;
		const direction = Math.sign(delta);
		const start =
			direction === this.#smoothWheelDirection
				? (this.#smoothWheelTarget ?? scroller.scrollTop)
				: scroller.scrollTop;
		const margin = this.#pageMargin(view);
		const alignedTarget =
			margin + (Math.round((start - margin) / lineHeight) + Math.round(delta / lineHeight)) * lineHeight;
		const target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, alignedTarget));
		const from = scroller.scrollTop;
		const startedAt = performance.now();

		this.#cancelWheelScroll();
		this.#smoothWheelDirection = direction;

		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === from) {
			scroller.scrollTop = target;

			return;
		}

		this.#smoothWheelTarget = target;

		const step = (now: number) => {
			const progress = Math.min(1, Math.max(0, (now - startedAt) / 200));
			const eased = 1 - (1 - progress) ** 2;

			scroller.scrollTop = from + (target - from) * eased;

			if (progress < 1) this.#wheelFrame = requestAnimationFrame(step);
			else {
				this.#wheelFrame = null;
				this.#smoothWheelTarget = null;
			}
		};

		this.#wheelFrame = requestAnimationFrame(step);
	}

	#cancelWheelScroll(): void {
		if (this.#wheelFrame !== null) cancelAnimationFrame(this.#wheelFrame);

		this.#wheelFrame = null;
		this.#smoothWheelTarget = null;
	}

	#resizeText(direction: -1 | 1, event: WheelEvent): void {
		const view = this.#view;
		const textSize = Math.max(8, Math.min(24, this.#session.appearance.textSize + direction));

		if (!view || textSize === this.#session.appearance.textSize) return;

		this.#cancelWheelScroll();
		this.#cancelTransition();

		const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
		const before = position === null ? null : view.coordsAtPos(position);
		const measurement = ++this.#measurement;

		this.#restoring = true;
		this.#session.appearance = { ...this.#session.appearance, textSize };
		flush(this.#session);

		requestAnimationFrame(() => {
			if (measurement !== this.#measurement || view !== this.#view) return;

			view.requestMeasure({
				read: () => (position === null ? null : view.coordsAtPos(position)),
				write: (after) => {
					if (measurement !== this.#measurement || view !== this.#view) return;

					requestAnimationFrame(() => {
						if (measurement !== this.#measurement || view !== this.#view) return;

						if (before && after) {
							const settled = position === null ? null : view.coordsAtPos(position);

							if (settled) view.scrollDOM.scrollTop += settled.top - before.top;
						}

						view.requestMeasure({
							read: () => null,
							write: () => {
								if (measurement !== this.#measurement || view !== this.#view) return;

								this.#restoring = false;
								this.#rememberSelection();
							},
						});
					});
				},
			});
		});
	}

	#selectionFor(pageId: string, length: number): EditorSelection {
		const remembered = this.#session.view.selections[pageId];
		const targets = this.#session.view.occurrence?.targets.filter((target) => target.pageId === pageId);
		const ranges = targets?.length
			? targets.map((target) => target.range)
			: (remembered?.ranges ?? [{ anchor: 0, head: 0 }]);
		const occurrence = this.#session.view.occurrence;
		const primaryTarget = occurrence?.targets[occurrence.primaryTarget];
		const mainIndex =
			primaryTarget?.pageId === pageId
				? Math.max(0, targets?.indexOf(primaryTarget) ?? 0)
				: (remembered?.mainIndex ?? 0);

		return EditorSelection.create(
			ranges.map((range) =>
				EditorSelection.range(
					Math.max(0, Math.min(length, range.anchor)),
					Math.max(0, Math.min(length, range.head)),
				),
			),
			Math.min(mainIndex, ranges.length - 1),
		);
	}

	#stateFor(pageId: string): EditorState {
		const text = this.#document.pages.find((page) => page.id === pageId)?.text ?? "";
		const cached = this.#states.get(pageId);
		const selection = this.#selectionFor(pageId, text.length);

		if (cached?.doc.toString() === text)
			return cached.update({
				selection,
				effects: this.#editable.reconfigure([
					EditorState.readOnly.of(this.#locked),
					EditorView.editable.of(!this.#locked),
				]),
			}).state;

		return EditorState.create({
			doc: text,
			selection,
			extensions: [
				EditorState.allowMultipleSelections.of(true),
				EditorState.tabSize.of(4),
				EditorView.lineWrapping,
				drawSelection(),
				createOccurrenceHighlights(
					() => {
						const occurrence = this.#session.view.occurrence;
						const remembered = this.#session.view.selections[this.#session.view.activePageId];
						const selected = remembered?.ranges ?? [];
						const range = selected[remembered?.mainIndex ?? 0];
						const page = this.#document.pages.find(
							(candidate) => candidate.id === this.#session.view.activePageId,
						);

						return {
							seed:
								occurrence ??
								(range && range.anchor !== range.head && page
									? {
											seed: page.text.slice(
												Math.min(range.anchor, range.head),
												Math.max(range.anchor, range.head),
											),
											seedPageId: page.id,
											seedRange: range,
											...this.#session.occurrencePreferences,
										}
									: null),
							selected: occurrence
								? occurrence.targets
										.filter((target) => target.pageId === this.#session.view.activePageId)
										.map((target) => target.range)
								: selected,
						};
					},
					{ document: this.#document, session: this.#session },
				),
				this.#editable.of([EditorState.readOnly.of(this.#locked), EditorView.editable.of(!this.#locked)]),
				EditorView.contentAttributes.of({ "aria-label": "Scratchpad text", spellcheck: "false" }),
				EditorView.theme({
					"&": { height: "100%" },
					".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
					".cm-content": { minHeight: "100%" },
					"&.cm-focused": { outline: "none" },
				}),
				keymap.of([
					{ key: "PageUp", run: () => this.#navigatePage(-1) },
					{ key: "PageDown", run: () => this.#navigatePage(1) },
					{ key: "Alt-ArrowUp", run: () => this.#navigatePage(-1) },
					{ key: "Alt-ArrowDown", run: () => this.#navigatePage(1) },
					{ key: "Mod-Home", run: () => this.#navigatePage("first") },
					{ key: "Mod-End", run: () => this.#navigatePage("last") },
					{
						key: "Mod-Delete",
						run: () => {
							this.apply({ type: "deletePage" });

							return true;
						},
					},
					{ key: "Mod-z", run: () => this.#replay("undo") },
					{ key: "Mod-y", run: () => this.#replay("redo") },
					{ key: "Mod-Shift-z", run: () => this.#replay("redo") },
					{
						key: "Mod-d",
						run: () => {
							if (!this.#locked) {
								this.finishComposition();
								this.#history.closeGroup();

								if (this.#callbacks.selectNextOccurrence) this.#callbacks.selectNextOccurrence();
								else this.selectNextOccurrence();

								this.refresh();
							}

							return true;
						},
					},
					{
						key: "Mod-f",
						run: () => {
							this.finishComposition();

							if (this.#callbacks.openFind) this.#callbacks.openFind();
							else this.openFind();

							return true;
						},
					},
					{
						key: "Tab",
						run: () => {
							this.apply({ type: "indent", direction: "in" });

							return true;
						},
					},
					{
						key: "Ctrl-Tab",
						run: () => {
							this.apply({ type: "indent", direction: "out" });

							return true;
						},
					},
					{ key: "Backspace", run: () => this.#delete("backward") },
					{ key: "Delete", run: () => this.#delete("forward") },
					{
						key: "Escape",
						run: () => {
							if (!this.#session.view.occurrence) return false;

							this.#endOccurrence(true);

							return true;
						},
					},
					...defaultKeymap,
				]),
				EditorView.inputHandler.of((_view, _from, _to, text) => {
					if (this.#composition) return false;

					if (
						"([{<'\"`".includes(text) &&
						text.length === 1 &&
						[...participatingRanges(this.#document, this.#session.view).values()].some((ranges) =>
							ranges.some((range) => range.anchor !== range.head),
						)
					) {
						this.apply({ type: "enclose", opening: text });

						return true;
					}

					return false;
				}),
				EditorView.domEventHandlers({
					compositionstart: () => {
						this.#menuGeneration++;
						this.#cancelTransition();

						if (!this.#locked && this.#view) {
							this.#history.closeGroup();
							this.#composition = {
								pages: this.#document.pages,
								view: snapshotView(this.#session.view),
								state: this.#view.state,
								latest: this.#view.state,
								changes: ChangeSet.empty(this.#view.state.doc.length),
							};
						}

						return false;
					},
					compositionend: () => {
						queueMicrotask(() => this.finishComposition());

						return false;
					},
					contextmenu: (event) => {
						if (!this.#callbacks.showTextContextMenu) return false;

						event.preventDefault();
						this.#selectContextPosition(event);
						void this.#showTextContextMenu();

						return true;
					},
					mousedown: (event) => {
						this.#cancelWheelScroll();
						this.#cancelTransition();

						if (event.button === 2 && this.#callbacks.showTextContextMenu) {
							event.preventDefault();
							this.#selectContextPosition(event);

							return true;
						}

						this.#endOccurrence(false);

						return false;
					},
					keydown: (event) => {
						if (["Shift", "Control", "Alt", "Meta", "AltGraph"].includes(event.key)) return false;

						this.#cancelWheelScroll();
						this.#cancelTransition();

						if (
							!event.altKey &&
							["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(
								event.key,
							)
						)
							this.#endOccurrence(true);

						return false;
					},
					paste: (event) => {
						if (!event.clipboardData || this.#locked) return false;

						event.preventDefault();
						this.apply({ type: "paste", text: event.clipboardData.getData("text/plain") });

						return true;
					},
					copy: (event) => this.#clipboard(event, false),
					cut: (event) => this.#clipboard(event, true),
					scroll: () => {
						if (!this.#updating && !this.#composition && !this.#restoring) this.rememberScroll();

						return false;
					},
				}),
			],
		});
	}

	rememberScroll(): void {
		if (!this.#view || this.#restoring || !this.#document.pages.some((page) => page.id === this.#pageId)) return;

		this.#history.scroll.positions[this.#pageId] = this.#view.scrollDOM.scrollTop - this.#pageMargin(this.#view);
	}

	#rememberSelection(): void {
		if (!this.#view || !this.#document.pages.some((page) => page.id === this.#pageId)) return;

		this.rememberScroll();

		const previous = this.#session.view.selections[this.#pageId];
		const selection = {
			ranges: this.#view.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
			mainIndex: this.#view.state.selection.mainIndex,
			scrollTop: previous?.scrollTop ?? 0,
		};

		if (previous && JSON.stringify(previous) === JSON.stringify(selection)) return;

		this.#session.view = snapshotView({
			...this.#session.view,
			selections: { ...this.#session.view.selections, [this.#pageId]: selection },
		});
	}

	#selectedFindIndex(matches: ReadonlyArray<TextMatch>): number {
		const pageId = this.#session.view.activePageId;
		const selection = this.#session.view.selections[pageId];
		const range = selection?.ranges[selection.mainIndex];

		if (!range) return -1;

		return matches.findIndex(
			(match) =>
				match.pageId === pageId &&
				match.from === Math.min(range.anchor, range.head) &&
				match.to === Math.max(range.anchor, range.head),
		);
	}

	#synchronizeFind(): void {
		if (!this.#session.find.open) return;

		const matches = findMatches(this.#session.find, { document: this.#document, session: this.#session });
		const activeMatch = this.#selectedFindIndex(matches);

		if (activeMatch !== this.#session.find.activeMatch) this.#session.find = { ...this.#session.find, activeMatch };
	}

	#navigatePage(direction: -1 | 1 | "first" | "last"): boolean {
		return this.#navigation.navigate(direction);
	}

	#endOccurrence(collapse: boolean): void {
		if (!this.#session.view.occurrence) return;

		this.#history.closeGroup();

		const view = this.#session.view;
		const head = this.#view?.state.selection.main.head ?? view.selections[view.activePageId]?.ranges[0]?.head ?? 0;

		this.#session.view = snapshotView({
			...view,
			occurrence: null,
			selections: collapse
				? {
						...view.selections,
						[view.activePageId]: {
							ranges: [{ anchor: head, head }],
							mainIndex: 0,
							scrollTop: this.#view ? this.#view.scrollDOM.scrollTop - this.#pageMargin(this.#view) : 0,
						},
					}
				: view.selections,
		});

		if (collapse) this.refresh();
	}

	#delete(direction: "backward" | "forward"): boolean {
		if (this.#locked) return true;

		this.finishComposition();
		this.#rememberSelection();

		const group = `delete:${direction}:${[...participatingRanges(this.#document, this.#session.view)].map(([pageId, ranges]) => `${pageId}:${ranges.length}`).join(",")}`;

		this.#history.commit({ ...prepareEdit({ type: "delete", direction }, this.#document, this.#session), group });
		this.refresh();

		return true;
	}

	#replay(direction: "undo" | "redo"): boolean {
		if (!this.#locked) {
			this.finishComposition();
			this.#history[direction]();
			this.refresh();
		}

		return true;
	}

	#selectContextPosition(event: MouseEvent): void {
		const view = this.#view;

		if (!view) return;

		this.#cancelTransition();
		this.finishComposition();

		const position = view.posAtCoords({ x: event.clientX, y: event.clientY });

		if (
			position !== null &&
			!view.state.selection.ranges.some((range) => !range.empty && position >= range.from && position <= range.to)
		) {
			this.#endOccurrence(false);
			view.dispatch({ selection: EditorSelection.cursor(position) });
		}

		view.focus();
	}

	async #showTextContextMenu(): Promise<void> {
		const view = this.#view;
		const show = this.#callbacks.showTextContextMenu;

		if (!view || !show) return;

		flush(this.#document);
		flush(this.#session);

		const generation = ++this.#menuGeneration;
		const state = view.state;
		const pages = this.#document.pages;
		const selection = this.#selectionOfMenu();
		const current = () =>
			generation === this.#menuGeneration &&
			this.#view === view &&
			!this.#composition &&
			this.#document.pages === pages &&
			this.#selectionOfMenu() === selection &&
			view.state.doc === state.doc &&
			view.state.selection.eq(state.selection);

		this.#menuSelection = selection;

		try {
			const response = await show({
				canUndo: this.#history.canUndo,
				canRedo: this.#history.canRedo,
				hasSelection: [...participatingRanges(this.#document, this.#session.view).values()].some((ranges) =>
					ranges.some((range) => range.anchor !== range.head),
				),
				locked: this.#locked,
			});

			if (!response || !current() || (this.#locked && response !== "copy" && response !== "selectAll")) return;

			if (response === "copy" || response === "cut") {
				if (!this.#callbacks.writeClipboard) return;

				await this.#callbacks.writeClipboard(this.#selectedText());

				if (!current()) return;

				if (response === "cut" && !this.#locked) this.apply({ type: "insert", text: "" });
			} else if (response === "paste") {
				if (!this.#callbacks.readClipboard) return;

				const text = await this.#callbacks.readClipboard();

				if (text === "" || !current() || this.#locked) return;

				this.apply({ type: "paste", text });
			} else if (response === "delete") this.apply({ type: "insert", text: "" });
			else if (response === "undo" || response === "redo") this.#replay(response);
			else {
				this.#endOccurrence(false);
				view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
			}

			this.focus();
		} catch {
			return;
		} finally {
			if (generation === this.#menuGeneration) this.#menuSelection = null;
		}
	}

	#selectionOfMenu(): string {
		return JSON.stringify({
			activePageId: this.#session.view.activePageId,
			occurrence: this.#session.view.occurrence,
			ranges: [...participatingRanges(this.#document, this.#session.view)],
		});
	}

	#selectedText(): string {
		const targets = participatingRanges(this.#document, this.#session.view);

		return this.#document.pages
			.flatMap((page) =>
				(targets.get(page.id) ?? []).map((range) =>
					page.text.slice(Math.min(range.anchor, range.head), Math.max(range.anchor, range.head)),
				),
			)
			.join("\n");
	}

	#clipboard(event: ClipboardEvent, cut: boolean): boolean {
		if (!event.clipboardData || !this.#session.view.occurrence || (cut && this.#locked)) return false;

		event.preventDefault();
		event.clipboardData.setData("text/plain", this.#selectedText());

		if (cut) this.apply({ type: "insert", text: "" });

		return true;
	}
}
