import { createMutableState, flush as flushState, subscribe } from "opshot";
import { contentHashOf } from "../utils/contentHashOf";
import { decodeText, type TextFormat } from "../utils/decodeText";
import { encodeText } from "../utils/encodeText";
import { parsePages } from "../utils/parsePages";
import { persistedPagesOf } from "../utils/persistedPagesOf";
import { sameFilePath } from "../utils/sameFilePath";
import { serializePages } from "../utils/serializePages";
import { appStateSchema, type AppState } from "./AppState";
import { createDocumentState, freezePages, type Page } from "./DocumentState";
import { EditorController } from "./EditorController";
import { History } from "./History";
import { PageNavigation } from "./PageNavigation";
import { recoveryRecordSchema, type RecoveryRecord } from "./RecoveryRecord";
import { createSessionState, snapshotView, type ViewSnapshot } from "./SessionState";
import type { DumpContext } from "./DumpContext";
import type { Main } from "./Main";
import type { MainEvents } from "./MainEvents";
import type { FileRead } from "../../shared/models/FileRead";
import type { WindowBounds } from "../../shared/models/MainEventMap";

interface PersistenceState {
	path: string | null;
	format: TextFormat;
	revision: number;
	savedRevision: number;
	phase: "loading" | "ready" | "saving" | "failed";
	error: string | null;
	generation: number;
	locked: boolean;
}

interface Revision {
	readonly path: string;
	readonly revision: number;
	readonly text: string;
	readonly format: TextFormat;
	readonly pages: ReadonlyArray<Page>;
	readonly view: ViewSnapshot;
}

interface PersistenceCallbacks {
	readonly openFind?: (context: DumpContext) => void;
	readonly selectNextOccurrence?: (context: DumpContext) => void;
}

const defaultFormat: TextFormat = { encoding: "utf8", bom: false, newline: "\n" };
const pageFileFilters = [
	{ name: "Text files", extensions: ["txt"] },
	{ name: "Markdown files", extensions: ["md"] },
	{ name: "All files", extensions: ["*"] },
];

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function recoveredPages(record: RecoveryRecord): ReadonlyArray<Page> {
	const parsed = parsePages(record.text);

	if (parsed.length !== record.pageIds.length || new Set(record.pageIds).size !== record.pageIds.length)
		throw new Error("Recovery page identifiers are invalid.");

	const pages = freezePages(parsed.map((page, index) => ({ ...page, id: record.pageIds[index] ?? page.id })));
	const lengths = new Map(pages.map((page) => [page.id, page.text.length]));
	const validRange = (pageId: string, range: { readonly anchor: number; readonly head: number }) => {
		const length = lengths.get(pageId);

		return length !== undefined && range.anchor <= length && range.head <= length;
	};
	const occurrence = record.view.occurrence;

	if (
		!lengths.has(record.view.activePageId) ||
		Object.entries(record.view.selections).some(([pageId, selection]) =>
			selection.ranges.some((range) => !validRange(pageId, range)),
		) ||
		occurrence?.targets.some((target) => !validRange(target.pageId, target.range))
	)
		throw new Error("Recovery selections are invalid.");

	return pages;
}

export class PersistenceController {
	readonly state = createMutableState<PersistenceState>({
		path: null,
		format: defaultFormat,
		revision: 0,
		savedRevision: 0,
		phase: "loading",
		error: null,
		generation: 0,
		locked: false,
	});
	readonly #main: Main;
	readonly #events: MainEvents;
	readonly #callbacks: PersistenceCallbacks;
	#context: DumpContext | null = null;
	#queue: Promise<void> = Promise.resolve();
	#latest: Revision | null = null;
	#backingHash: string | null = null;
	#stateHash: string | null = null;
	#journalHash: string | null = null;
	#durableRevision = -1;
	#statePath = "";
	#journalPath = "";
	#userData = "";
	#settings: AppState | null = null;
	#windowBounds: WindowBounds | null = null;
	#unsubscribeSession: (() => void) | null = null;
	#unsubscribeScroll: (() => void) | null = null;
	#debounce: ReturnType<typeof setTimeout> | null = null;
	#maximumWait: ReturnType<typeof setTimeout> | null = null;
	#settingsTimer: ReturnType<typeof setTimeout> | null = null;
	#paused = false;
	#missing = false;
	#placeholder = false;
	#disposed = false;
	#transition = false;
	#initializing: Promise<void> | null = null;
	readonly #closeRequested = () => {
		void this.close();
	};
	readonly #boundsChanged = (bounds: WindowBounds) => {
		this.#windowBounds = bounds;
		this.#scheduleSettings();
	};

	constructor(main: Main, events: MainEvents, callbacks: PersistenceCallbacks = {}) {
		this.#main = main;
		this.#events = events;
		this.#callbacks = callbacks;
		events.on("closeRequested", this.#closeRequested);
		events.on("windowBoundsChanged", this.#boundsChanged);
	}

	get context(): DumpContext | null {
		return this.#context;
	}

	initialize(): Promise<void> {
		this.#initializing ??= this.#initialize().catch((error: unknown) => {
			this.#initializing = null;
			this.#fail(error);
		});

		return this.#initializing;
	}

	changed(): void {
		if (this.#disposed || !this.#context || !this.state.path) return;

		this.state.revision++;
		this.#latest = this.#capture();

		const revision = this.#latest;

		void this.#enqueue(() => this.#writeJournal(revision)).catch((error: unknown) => this.#fail(error));

		if (!this.#paused) {
			this.state.phase = "saving";
			this.#scheduleSave();
		}
	}

	async flush(): Promise<void> {
		if (this.#disposed) {
			await this.#queue;

			return;
		}

		if (!this.context) await this.initialize();

		const context = this.context;

		if (!context) throw new Error(this.state.error ?? "The dump could not load.");

		context.editor.finishComposition();
		context.history.closeGroup();
		this.#clearTimers();

		try {
			await this.#queue;
			this.#paused = false;
			this.state.error = null;
			await this.#enqueue(async () => {
				if (this.#missing) await this.#retryBacking();

				const revision = this.#capture();

				if (this.state.revision > this.state.savedRevision) {
					await this.#writeJournal(revision);
					await this.#writeBacking(revision);
				} else {
					if (this.#missing) throw new Error("The current file is missing. Use Save As to keep this dump.");

					if (this.#durableRevision < revision.revision) await this.#writeJournal(revision);

					await this.#writeSettings(revision, this.#backingHash);
				}
			});
			this.state.phase = this.state.revision === this.state.savedRevision ? "ready" : "saving";
		} catch (error) {
			this.#fail(error);

			throw error;
		}
	}

	async open(): Promise<void> {
		if (this.#transition || this.#disposed) return;

		this.#transition = true;

		try {
			const candidate = await this.#main.showOpenDialog({
				title: "Open dump",
				...(this.state.path ? { defaultPath: this.state.path } : {}),
			});

			if (!candidate) return;

			this.#setLocked(true);

			if (this.#context && !(this.#missing && this.state.revision === this.state.savedRevision)) await this.flush();
			else {
				await this.#queue;

				const previous = await this.#main.readFile(this.#statePath);

				if (previous) await this.#preserve("app-state", previous);

				const previousRecovery = await this.#main.readFile(this.#journalPath);

				if (previousRecovery) await this.#preserve("recovery", previousRecovery);
			}

			if (this.state.path && sameFilePath(candidate.path, this.state.path)) return;

			const file = await this.#main.readFile(candidate.path);

			if (!file) throw new Error("The selected file is missing.");

			const decoded = decodeText(file.bytes);
			const pages = parsePages(decoded.text);
			const view = createSessionState(pages).view;
			const revision: Revision = {
				path: candidate.path,
				revision: 0,
				text: serializePages(pages),
				format: decoded.format,
				pages,
				view,
			};

			await this.#enqueue(() => this.#writeSettings(revision, file.hash));
			this.#missing = false;
			this.#placeholder = false;
			this.#install(revision, file.hash, 0);
			await this.#enqueue(() => this.#writeJournal(revision));
			this.state.phase = "ready";
		} catch (error) {
			this.#fail(error);
		} finally {
			this.#setLocked(false);
			this.#transition = false;
		}
	}

	async saveAs(): Promise<void> {
		if (this.#transition || this.#disposed || !this.#context) return;

		this.#transition = true;

		try {
			const candidate = await this.#main.showSaveDialog({
				title: "Save dump as",
				...(this.state.path ? { defaultPath: this.state.path } : {}),
			});

			if (!candidate) return;

			this.#setLocked(true);

			if (this.state.path && sameFilePath(candidate.path, this.state.path)) {
				await this.flush();

				return;
			}

			try {
				await this.flush();
			} catch {
				await this.#queue;
			}

			const current = this.#capture();
			const revision: Revision = { ...current, path: candidate.path };

			await this.#enqueue(async () => {
				const result = await this.#main.writeFile({
					path: candidate.path,
					bytes: encodeText(revision.text, revision.format),
					expectedHash: candidate.hash,
				});

				try {
					await this.#writeSettings(revision, result.hash);
				} catch (error) {
					throw new Error(
						`A copy was written to ${candidate.path}, but the current dump could not switch: ${errorMessage(error)}`,
					);
				}

				this.state.path = candidate.path;
				this.#backingHash = result.hash;
				this.state.savedRevision = revision.revision;
				this.#latest = revision;
				this.#missing = false;
				this.#placeholder = false;
				this.#paused = false;
				this.state.error = null;
				this.#durableRevision = -1;
				await this.#writeJournal(revision);
			});
			this.state.phase = "ready";
		} catch (error) {
			this.#fail(error);
		} finally {
			this.#setLocked(false);
			this.#transition = false;
		}
	}

	async importPage(): Promise<void> {
		if (this.#transition || this.#disposed || !this.#context) return;

		this.#transition = true;
		this.#setLocked(true);

		const { document, session, history, editor } = this.#context;
		const pageId = session.view.activePageId;

		try {
			const candidate = await this.#main.showOpenDialog({
				title: "Import page",
				filters: [{ name: "All files", extensions: ["*"] }],
			});

			if (!candidate) return;

			const file = await this.#main.readFile(candidate.path);

			if (!file) throw new Error("The selected file is missing.");

			const text = new TextDecoder("utf-8").decode(file.bytes).replace(/\r\n?/gu, "\n").replace(/\f/gu, "\u240c");

			if (this.state.phase !== "failed") this.state.error = null;

			if (document.pages.find((page) => page.id === pageId)?.text === text) return;

			const before = snapshotView(session.view);

			history.closeGroup();
			history.commit({
				pages: document.pages.map((page) => (page.id === pageId ? { id: pageId, text } : page)),
				before,
				after: snapshotView({
					...before,
					occurrence: null,
					selections: {
						...before.selections,
						[pageId]: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 },
					},
				}),
				group: null,
			});
			editor.refresh();
		} catch (error) {
			this.state.error = errorMessage(error);
		} finally {
			this.#setLocked(false);
			this.#transition = false;
			editor.focus();
		}
	}

	async exportPage(): Promise<void> {
		if (this.#transition || this.#disposed || !this.#context) return;

		this.#transition = true;
		this.#setLocked(true);

		const { document, session, editor } = this.#context;
		const index = document.pages.findIndex((page) => page.id === session.view.activePageId);
		const text = document.pages[index]?.text ?? "";

		try {
			const candidate = await this.#main.showSaveDialog({
				title: "Export page",
				defaultPath: `page-${index + 1}.txt`,
				filters: pageFileFilters,
			});

			if (!candidate) return;

			if (this.state.path && sameFilePath(candidate.path, this.state.path))
				throw new Error("Choose a different file for page export; this file stores the whole dump.");

			await this.#main.writeFile({
				path: candidate.path,
				bytes: new TextEncoder().encode(text),
				expectedHash: candidate.hash,
			});
		} catch (error) {
			this.state.error = errorMessage(error);
		} finally {
			this.#setLocked(false);
			this.#transition = false;
			editor.focus();
		}
	}

	async close(): Promise<void> {
		if (this.#transition || this.#disposed) return;

		this.#transition = true;
		this.#setLocked(true);

		try {
			await this.flush();
			await this.#main.finishClose();
		} catch (error) {
			this.#fail(error);
		} finally {
			this.#setLocked(false);
			this.#transition = false;
		}
	}

	dispose(): void {
		this.#disposed = true;
		this.#clearTimers();
		this.#events.off("closeRequested", this.#closeRequested);
		this.#events.off("windowBoundsChanged", this.#boundsChanged);
		this.#unsubscribeSession?.();
		this.#unsubscribeScroll?.();
		this.#context?.editor.dispose();
		this.#context?.history.dispose();
	}

	async #initialize(): Promise<void> {
		const paths = await this.#main.getPaths();

		this.#userData = paths.userData;
		this.#statePath = `${paths.userData}/app-state.json`;
		this.#journalPath = `${paths.userData}/recovery.json`;

		const stateFile =
			paths.startupSettings === undefined ? await this.#main.readFile(this.#statePath) : paths.startupSettings;

		this.#stateHash = stateFile?.hash ?? null;

		let warning: string | null = null;

		if (stateFile) {
			try {
				this.#settings = appStateSchema.parse(JSON.parse(decodeText(stateFile.bytes).text));
			} catch {
				await this.#preserve("app-state", stateFile);
				warning = "Invalid app settings were preserved; default settings are in use.";
			}
		}

		this.#windowBounds = this.#settings?.windowBounds ?? null;

		const path =
			this.#settings && paths.restoredFilePath && sameFilePath(this.#settings.activePath, paths.restoredFilePath)
				? this.#settings.activePath
				: `${paths.userData}/dump.txt`;
		let file: FileRead | null = null;
		let backingReadFailure: string | null = null;

		const [backingResult, journalResult] = await Promise.allSettled([
			this.#main.readFile(path),
			this.#main.readFile(this.#journalPath),
		]);

		if (backingResult.status === "fulfilled") file = backingResult.value;
		else backingReadFailure = errorMessage(backingResult.reason);

		if (journalResult.status === "rejected") throw journalResult.reason;

		const journalFile = journalResult.value;

		this.#journalHash = journalFile?.hash ?? null;

		let recovery: RecoveryRecord | null = null;

		if (journalFile) {
			try {
				recovery = recoveryRecordSchema.parse(JSON.parse(decodeText(journalFile.bytes).text));
				recoveredPages(recovery);
			} catch {
				await this.#preserve("recovery", journalFile);
				warning = "Invalid recovery data was preserved. Review the current dump before retrying.";
				recovery = null;
			}

			if (recovery && !sameFilePath(recovery.path, path)) {
				await this.#preserve("recovery", journalFile);
				recovery = null;
			}
		}

		if (!file && !this.#settings && !recovery && !backingReadFailure) {
			const bytes = new Uint8Array();
			const result = await this.#main.writeFile({ path, bytes, expectedHash: null });

			file = { bytes, hash: result.hash };
		}

		this.#missing = file === null;

		let decoded = { text: "", format: defaultFormat };
		let decodingFailure: string | null = null;

		if (file) {
			try {
				decoded = decodeText(file.bytes);
			} catch (error) {
				if (!recovery) throw error;

				decodingFailure = errorMessage(error);
			}
		}

		this.#placeholder = file === null && recovery === null;

		let pages = parsePages(decoded.text);
		let view = this.#restoredView(pages, file?.hash ?? null);
		let format = decoded.format;
		let revisionNumber = 0;
		let savedRevision = 0;
		let backingHash = file?.hash ?? null;

		if (recovery && file && !decodingFailure && this.#settings && file.hash !== this.#settings.savedContentHash) {
			const payloadHash = await contentHashOf(encodeText(recovery.text, recovery.format));

			if (
				payloadHash === this.#settings.savedContentHash ||
				(recovery.revision === 0 && recovery.baseHash === this.#settings.savedContentHash)
			) {
				if (journalFile) await this.#preserve("recovery", journalFile);

				recovery = null;
			}
		}

		if (recovery) {
			pages = recoveredPages(recovery);
			view = snapshotView(recovery.view);
			format = recovery.format;
			revisionNumber = recovery.revision;

			const payloadHash = await contentHashOf(encodeText(recovery.text, recovery.format));

			const savedHash = file?.hash ?? this.#settings?.savedContentHash;

			if (payloadHash === savedHash || (revisionNumber === 0 && recovery.baseHash === savedHash)) {
				savedRevision = revisionNumber;
				backingHash = savedHash ?? null;

				if (savedHash && this.#settings?.savedContentHash === savedHash)
					view = this.#restoredView(pages, savedHash);
			} else {
				savedRevision = revisionNumber - 1;

				if (recovery.baseHash !== backingHash || this.#missing) {
					backingHash = recovery.baseHash;
					warning =
						"The backing file changed or is missing. Recovery text is preserved here; use Save As to keep it.";
				}
			}
		}

		this.#install(
			{ path, revision: revisionNumber, text: serializePages(pages), format, pages, view },
			backingHash,
			savedRevision,
		);

		if (this.#missing) warning = "The current file is missing. Recovery text is available; use Open or Save As.";

		if (backingReadFailure)
			warning = `The current file could not be read: ${backingReadFailure}. Recovery text is available; use Open or Save As.`;

		if (decodingFailure)
			warning = `The current file could not be decoded: ${decodingFailure} Recovery text is preserved here; use Save As to keep it.`;

		if (warning) {
			if (!this.#missing && recovery === null)
				await this.#enqueue(() => this.#writeSettings(this.#capture(), this.#backingHash));

			this.#fail(new Error(warning));

			return;
		}

		if (savedRevision < revisionNumber) await this.flush();
		else {
			await this.#enqueue(() => this.#writeSettings(this.#capture(), this.#backingHash));
			this.state.phase = "ready";
		}
	}

	#restoredView(pages: ReadonlyArray<Page>, hash: string | null): ViewSnapshot {
		const initial = createSessionState(pages).view;

		if (!this.#settings || this.#settings.savedContentHash !== hash) return initial;

		const selections = { ...initial.selections };

		for (const [index, page] of pages.entries()) {
			const selection = this.#settings.selections[index];

			if (selection?.ranges.every((range) => range.anchor <= page.text.length && range.head <= page.text.length))
				selections[page.id] = selection;
		}

		return snapshotView({
			...initial,
			activePageId: pages[this.#settings.activePageIndex]?.id ?? initial.activePageId,
			selections,
		});
	}

	async #retryBacking(): Promise<void> {
		const path = this.state.path;

		if (!path) throw new Error("The dump is still loading.");

		const file = await this.#main.readFile(path);

		if (!file) throw new Error("The current file is missing. Use Save As to keep this dump.");

		if (this.#placeholder) {
			if (this.state.revision > 0)
				throw new Error("Text was entered while the original file was unavailable. Use Save As to preserve it.");

			const decoded = decodeText(file.bytes);
			const pages = parsePages(decoded.text);
			const view = this.#restoredView(pages, file.hash);

			this.#install(
				{ path, revision: 0, text: serializePages(pages), format: decoded.format, pages, view },
				file.hash,
				0,
			);
			this.#placeholder = false;
		} else if (file.hash !== this.#backingHash) {
			throw new Error(
				"The backing file changed while it was unavailable. Recovery text is preserved; use Save As to keep it.",
			);
		}

		this.#missing = false;
	}

	#install(revision: Revision, hash: string | null, savedRevision: number): void {
		this.#unsubscribeSession?.();
		this.#unsubscribeScroll?.();
		this.#context?.editor.dispose();
		this.#context?.history.dispose();

		const document = createDocumentState(revision.pages);
		const session = createSessionState(revision.pages);

		session.view = snapshotView(revision.view);

		if (this.#settings) {
			session.appearance = { ...this.#settings.appearance };
			session.find = { ...session.find, ...this.#settings.findPreferences };
			session.occurrencePreferences = { ...this.#settings.occurrencePreferences };
		}

		const history = new History(document, session, () => this.changed());
		const navigation = new PageNavigation(document, session);
		const editor = new EditorController(document, session, history, navigation, {
			showTextContextMenu: (state) => this.#main.showTextContextMenu(state),
			readClipboard: () => this.#main.readClipboard(),
			writeClipboard: (text) => this.#main.writeClipboard(text),
			...(this.#callbacks.openFind
				? {
						openFind: () => {
							if (this.#context) this.#callbacks.openFind?.(this.#context);
						},
					}
				: {}),
			...(this.#callbacks.selectNextOccurrence
				? {
						selectNextOccurrence: () => {
							if (this.#context) this.#callbacks.selectNextOccurrence?.(this.#context);
						},
					}
				: {}),
		});

		this.#context = {
			main: this.#main,
			events: this.#events,
			persistence: this,
			persistenceState: this.state,
			document,
			session,
			history,
			editor,
			navigation,
		};
		this.state.path = revision.path;
		this.state.format = revision.format;
		this.state.revision = revision.revision;
		this.state.savedRevision = savedRevision;
		this.#backingHash = hash;
		this.#latest = revision;
		this.#durableRevision = -1;
		this.#paused = false;
		this.state.error = null;
		this.#unsubscribeSession = subscribe(session, () => this.#scheduleSettings());
		this.#unsubscribeScroll = subscribe(history.scroll.positions, () => this.#scheduleSettings());
		editor.setLocked(this.state.locked);
		this.state.generation++;
		flushState(this.state);
	}

	#capture(): Revision {
		const context = this.#context;
		const path = this.state.path;

		if (!context || !path) throw new Error("The dump is still loading.");

		context.editor.rememberScroll();

		const persisted = persistedPagesOf(context.document.pages, context.history.scroll.capture(context.session.view));

		return Object.freeze({
			path,
			revision: this.state.revision,
			text: serializePages(persisted.pages),
			format: Object.freeze({ ...this.state.format }),
			pages: persisted.pages,
			view: snapshotView(persisted.view),
		});
	}

	#enqueue<Result>(job: () => Promise<Result>): Promise<Result> {
		const result = this.#queue.then(job);

		this.#queue = result.then(
			() => undefined,
			() => undefined,
		);

		return result;
	}

	async #writeJournal(revision: Revision): Promise<void> {
		const record: RecoveryRecord = {
			version: 1,
			path: revision.path,
			baseHash: this.#backingHash,
			revision: revision.revision,
			text: revision.text,
			format: revision.format,
			pageIds: revision.pages.map((page) => page.id),
			view: revision.view,
		};
		const result = await this.#main.writeFile({
			path: this.#journalPath,
			bytes: new TextEncoder().encode(JSON.stringify(record)),
			expectedHash: this.#journalHash,
		});

		this.#journalHash = result.hash;
		this.#durableRevision = revision.revision;
	}

	async #writeBacking(revision: Revision): Promise<void> {
		if (this.#missing) throw new Error("The current file is missing. Use Save As to keep this dump.");

		if (revision.revision < this.#durableRevision) return;

		this.state.phase = "saving";

		const result = await this.#main.writeFile({
			path: revision.path,
			bytes: encodeText(revision.text, revision.format),
			expectedHash: this.#backingHash,
		});

		this.#backingHash = result.hash;
		this.state.savedRevision = revision.revision;
		await this.#writeSettings(revision, result.hash);

		if (!this.#paused) this.state.phase = this.state.revision === revision.revision ? "ready" : "saving";
	}

	async #writeSettings(revision: Revision, hash: string | null): Promise<void> {
		const session = this.#context?.session ?? createSessionState(revision.pages);
		const record: AppState = {
			version: 1,
			activePath: revision.path,
			appearance: { ...session.appearance },
			findPreferences: { matchCase: session.find.matchCase, allPages: session.find.allPages },
			occurrencePreferences: { ...session.occurrencePreferences },
			windowBounds: this.#windowBounds,
			savedContentHash: hash,
			activePageIndex: Math.max(
				0,
				revision.pages.findIndex((page) => page.id === revision.view.activePageId),
			),
			selections: revision.pages.map(
				(page) =>
					revision.view.selections[page.id] ?? { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 },
			),
		};
		const result = await this.#main.writeFile({
			path: this.#statePath,
			bytes: new TextEncoder().encode(JSON.stringify(record)),
			expectedHash: this.#stateHash,
		});

		this.#stateHash = result.hash;
		this.#settings = record;
	}

	#scheduleSave(): void {
		if (this.#debounce) clearTimeout(this.#debounce);

		const save = () => {
			this.#clearSaveTimers();
			void this.#enqueue(async () => {
				if (this.#paused || this.#disposed || !this.#latest) return;

				const revision = this.#latest;

				if (revision.revision <= this.state.savedRevision) return;

				if (revision.revision > this.#durableRevision) await this.#writeJournal(revision);

				await this.#writeBacking(revision);
			}).catch((error: unknown) => this.#fail(error));
		};

		this.#debounce = setTimeout(save, 250);
		this.#maximumWait ??= setTimeout(save, 1000);
	}

	#scheduleSettings(): void {
		if (this.#disposed || this.state.locked || !this.#context || this.#settingsTimer) return;

		this.#settingsTimer = setTimeout(() => {
			this.#settingsTimer = null;
			void this.#enqueue(async () => {
				if (this.#disposed || this.state.locked || this.state.revision !== this.state.savedRevision) return;

				await this.#writeSettings(this.#capture(), this.#backingHash);
			}).catch((error: unknown) => this.#fail(error));
		}, 250);
	}

	#clearSaveTimers(): void {
		if (this.#debounce) clearTimeout(this.#debounce);

		if (this.#maximumWait) clearTimeout(this.#maximumWait);

		this.#debounce = null;
		this.#maximumWait = null;
	}

	#clearTimers(): void {
		this.#clearSaveTimers();

		if (this.#settingsTimer) clearTimeout(this.#settingsTimer);

		this.#settingsTimer = null;
	}

	#setLocked(locked: boolean): void {
		this.#context?.editor.setLocked(locked);
		this.state.locked = locked;
		flushState(this.state);
	}

	#fail(error: unknown): void {
		this.#paused = true;
		this.state.phase = "failed";
		this.state.error = errorMessage(error);
		this.#clearSaveTimers();
	}

	async #preserve(name: string, file: FileRead): Promise<void> {
		await this.#main.writeFile({
			path: `${this.#userData}/${name}-${Date.now()}-${crypto.randomUUID()}.json`,
			bytes: file.bytes,
			expectedHash: null,
		});
	}
}
