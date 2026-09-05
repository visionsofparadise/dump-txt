import { batch, flush, subscribe, type Operation } from "opshot";
import { freezePages, type DocumentState, type PreparedEdit } from "./DocumentState";
import { snapshotView, type SessionState, type ViewSnapshot } from "./SessionState";

interface HistoryEntry {
	readonly operations: ReadonlyArray<Operation>;
	readonly before: ViewSnapshot;
	readonly after: ViewSnapshot;
	readonly group: string | null;
	readonly completedAt: number;
}

export function replayOperation(operation: Operation, direction: "before" | "after"): void {
	if (Object.hasOwn(operation, direction)) Reflect.set(operation.node, operation.key, operation[direction]);
	else Reflect.deleteProperty(operation.node, operation.key);
}

export class History {
	private readonly undoEntries: Array<HistoryEntry> = [];
	private readonly redoEntries: Array<HistoryEntry> = [];
	private readonly unsubscribe: () => void;
	private readonly replayMeta = Symbol("history-replay");
	private pendingMeta: object | null = null;
	private pendingOperations: Array<Operation> = [];
	private groupOpen = false;
	private disposed = false;

	constructor(
		private readonly document: DocumentState,
		private readonly session: SessionState,
		private readonly changed: () => void = () => undefined,
	) {
		this.unsubscribe = subscribe(document, (operations) => {
			for (const operation of operations) {
				if (this.pendingMeta !== null && operation.meta === this.pendingMeta) {
					this.pendingOperations.push(operation);
				}
			}
		});
		this.updateStatus();
	}

	get canUndo(): boolean {
		return this.session.canUndo;
	}
	get canRedo(): boolean {
		return this.session.canRedo;
	}

	commit(edit: PreparedEdit): void {
		if (this.disposed) return;

		const pages = freezePages(edit.pages);
		const before = snapshotView(edit.before);
		const after = snapshotView(edit.after);

		flush(this.document);
		this.pendingMeta = {};
		this.pendingOperations = [];

		try {
			batch(() => {
				this.document.pages = pages;
			}, this.pendingMeta);
			flush(this.document);
		} finally {
			this.pendingMeta = null;
		}

		this.session.view = after;

		const operations = Object.freeze(this.pendingOperations);

		this.pendingOperations = [];

		if (operations.length === 0) return;

		const completedAt = Date.now();
		const previous = this.undoEntries.at(-1);

		if (
			this.groupOpen &&
			edit.group !== null &&
			previous?.group === edit.group &&
			completedAt - previous.completedAt <= 600
		) {
			this.undoEntries.pop();
			this.undoEntries.push({
				operations: Object.freeze([...previous.operations, ...operations]),
				before: previous.before,
				after,
				group: edit.group,
				completedAt,
			});
		} else this.undoEntries.push({ operations, before, after, group: edit.group, completedAt });

		this.groupOpen = edit.group !== null;
		this.redoEntries.length = 0;
		this.updateStatus();
		this.changed();
	}

	undo(): void {
		this.replay(this.undoEntries, this.redoEntries, "before");
	}

	redo(): void {
		this.replay(this.redoEntries, this.undoEntries, "after");
	}

	closeGroup(): void {
		this.groupOpen = false;
	}

	clear(): void {
		this.closeGroup();
		this.undoEntries.length = 0;
		this.redoEntries.length = 0;
		this.updateStatus();
	}

	dispose(): void {
		this.disposed = true;
		this.unsubscribe();
		this.clear();
	}

	private replay(source: Array<HistoryEntry>, destination: Array<HistoryEntry>, direction: "before" | "after"): void {
		if (this.disposed) return;

		this.closeGroup();

		const entry = source.pop();

		if (!entry) return;

		flush(this.document);

		const operations = direction === "before" ? [...entry.operations].reverse() : entry.operations;

		batch(() => {
			for (const operation of operations) replayOperation(operation, direction);
		}, this.replayMeta);
		flush(this.document);
		this.session.view = entry[direction];
		destination.push(entry);
		this.updateStatus();
		this.changed();
	}

	private updateStatus(): void {
		this.session.canUndo = this.undoEntries.length > 0;
		this.session.canRedo = this.redoEntries.length > 0;
		flush(this.session);
	}
}
