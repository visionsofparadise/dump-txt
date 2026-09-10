import { createMutableState } from "opshot";
import type { Page } from "./DocumentState";

export interface TextRange {
	readonly anchor: number;
	readonly head: number;
}

export interface PageSelection {
	readonly ranges: ReadonlyArray<TextRange>;
	readonly mainIndex: number;
	readonly scrollTop: number;
}

export interface OccurrenceSession {
	readonly seed: string;
	readonly seedPageId: string;
	readonly seedRange: TextRange;
	readonly steps: number;
	readonly matchCase: boolean;
	readonly allPages: boolean;
	readonly targets: ReadonlyArray<{ readonly pageId: string; readonly range: TextRange }>;
	readonly primaryTarget: number;
}

export interface ViewSnapshot {
	readonly activePageId: string;
	readonly selections: Readonly<Record<string, PageSelection>>;
	readonly occurrence: OccurrenceSession | null;
}

export interface FindOptions {
	readonly query: string;
	readonly matchCase: boolean;
	readonly allPages: boolean;
}

export interface TextMatch {
	readonly pageId: string;
	readonly from: number;
	readonly to: number;
}

export interface SessionState {
	view: ViewSnapshot;
	find: FindOptions & { readonly replacement: string; readonly activeMatch: number; readonly open: boolean };
	appearance: {
		readonly theme: "system" | "light" | "dark";
		readonly font: string;
		readonly textSize: number;
		readonly showStatusBar?: boolean;
	};
	occurrencePreferences: { readonly matchCase: boolean; readonly allPages: boolean };
	canUndo: boolean;
	canRedo: boolean;
}

export function snapshotView(view: ViewSnapshot): ViewSnapshot {
	const selections = Object.fromEntries(
		Object.entries(view.selections).map(([pageId, selection]) => [
			pageId,
			Object.isFrozen(selection)
				? selection
				: Object.freeze({
						...selection,
						ranges: Object.isFrozen(selection.ranges)
							? selection.ranges
							: Object.freeze(selection.ranges.map((range) => Object.freeze({ ...range }))),
					}),
		]),
	);
	const occurrence = view.occurrence;

	return Object.freeze({
		activePageId: view.activePageId,
		selections: Object.freeze(selections),
		occurrence:
			occurrence === null
				? null
				: Object.freeze({
						...occurrence,
						seedRange: Object.freeze({ ...occurrence.seedRange }),
						targets: Object.freeze(
							occurrence.targets.map((target) =>
								Object.freeze({
									pageId: target.pageId,
									range: Object.freeze({ ...target.range }),
								}),
							),
						),
					}),
	});
}

export function createSessionState(pages: ReadonlyArray<Page>): SessionState {
	const first = pages[0];

	if (!first) throw new Error("A session requires a page.");

	return createMutableState<SessionState>({
		view: snapshotView({
			activePageId: first.id,
			selections: Object.fromEntries(
				pages.map((page) => [
					page.id,
					{
						ranges: [{ anchor: 0, head: 0 }],
						mainIndex: 0,
						scrollTop: 0,
					},
				]),
			),
			occurrence: null,
		}),
		find: { query: "", matchCase: false, allPages: false, replacement: "", activeMatch: -1, open: false },
		appearance: { theme: "system", font: "Consolas", textSize: 11, showStatusBar: true },
		occurrencePreferences: { matchCase: false, allPages: false },
		canUndo: false,
		canRedo: false,
	});
}
