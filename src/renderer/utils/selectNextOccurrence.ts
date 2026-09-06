import { flush } from "opshot";
import { snapshotView, type OccurrenceSession, type TextRange } from "../models/SessionState";
import { occurrenceMatchesOf } from "./occurrenceMatchesOf";
import type { DumpContext } from "../models/DumpContext";

type OccurrenceContext = Pick<DumpContext, "document" | "session" | "history" | "editor">;

function seedOf(context: OccurrenceContext): { readonly seed: string; readonly range: TextRange } | null {
	const { document, session } = context;
	const page = document.pages.find((candidate) => candidate.id === session.view.activePageId);
	const selection = session.view.selections[session.view.activePageId];
	const range = selection?.ranges[selection.mainIndex] ?? { anchor: 0, head: 0 };

	if (!page) return null;

	if (range.anchor !== range.head)
		return { seed: page.text.slice(Math.min(range.anchor, range.head), Math.max(range.anchor, range.head)), range };

	for (const match of page.text.matchAll(/[\p{L}\p{N}\p{M}_]+/gu)) {
		const from = match.index;
		const to = from + match[0].length;

		if (from <= range.head && to >= range.head) return { seed: match[0], range: { anchor: from, head: to } };
	}

	return null;
}

function installOccurrence(occurrence: OccurrenceSession | null, context: OccurrenceContext): void {
	const { session, editor } = context;
	const primary = occurrence?.targets[occurrence.primaryTarget];
	const selections = { ...session.view.selections };

	if (occurrence) {
		for (const pageId of new Set(occurrence.targets.map((target) => target.pageId))) {
			const targets = occurrence.targets.filter((target) => target.pageId === pageId);

			selections[pageId] = {
				ranges: targets.map((target) => target.range),
				mainIndex: Math.max(
					0,
					targets.findIndex((target) => target === primary),
				),
				scrollTop: selections[pageId]?.scrollTop ?? 0,
			};
		}
	}

	session.view = snapshotView({
		...session.view,
		activePageId: primary?.pageId ?? session.view.activePageId,
		selections,
		occurrence,
	});
	flush(session);
	editor.refresh();
	editor.revealSelection();
}

export function rebuildOccurrence(context: OccurrenceContext): void {
	const { document, session, history } = context;
	const occurrence = session.view.occurrence;

	if (!occurrence) return;

	history.closeGroup();

	const preferences = session.occurrencePreferences;
	const matches = occurrenceMatchesOf({ ...occurrence, ...preferences }, context);

	if (matches.length === 0) {
		context.editor.closeOccurrence();

		return;
	}

	const pageIndex = document.pages.findIndex((page) => page.id === occurrence.seedPageId);
	let start = matches.findIndex((match) => {
		const index = document.pages.findIndex((page) => page.id === match.pageId);

		return (
			index > pageIndex ||
			(index === pageIndex && match.from >= Math.min(occurrence.seedRange.anchor, occurrence.seedRange.head))
		);
	});

	if (start === -1) start = 0;

	const ordered = [...matches.slice(start), ...matches.slice(0, start)];
	const targets = ordered
		.slice(0, occurrence.steps)
		.map((match) => ({ pageId: match.pageId, range: { anchor: match.from, head: match.to } }));

	installOccurrence({ ...occurrence, ...preferences, targets, primaryTarget: targets.length - 1 }, context);
}

export function selectNextOccurrence(context: OccurrenceContext): void {
	const { document, session, history, editor } = context;

	history.closeGroup();

	let occurrence = session.view.occurrence;

	if (!occurrence) {
		const seed = seedOf(context);

		if (!seed?.seed) return;

		const selected = session.view.selections[session.view.activePageId];
		const initial = selected?.ranges[selected.mainIndex];

		installOccurrence(
			{
				seed: seed.seed,
				seedPageId: session.view.activePageId,
				seedRange: seed.range,
				steps: 1,
				...session.occurrencePreferences,
				targets: [{ pageId: session.view.activePageId, range: seed.range }],
				primaryTarget: 0,
			},
			context,
		);
		editor.focus();

		if (!initial || initial.anchor === initial.head) return;

		occurrence = session.view.occurrence;
	}

	if (!occurrence) return;

	const matches = occurrenceMatchesOf(occurrence, context);
	const primary = occurrence.targets[occurrence.primaryTarget];

	if (!primary) return;

	const primaryPage = document.pages.findIndex((page) => page.id === primary.pageId);
	const available = matches.filter(
		(match) =>
			!occurrence.targets.some(
				(target) =>
					target.pageId === match.pageId &&
					Math.min(target.range.anchor, target.range.head) < match.to &&
					Math.max(target.range.anchor, target.range.head) > match.from,
			),
	);
	const next =
		available.find((match) => {
			const index = document.pages.findIndex((page) => page.id === match.pageId);

			return (
				index > primaryPage ||
				(index === primaryPage && match.from >= Math.max(primary.range.anchor, primary.range.head))
			);
		}) ?? available[0];

	if (!next) return;

	const targets = [...occurrence.targets, { pageId: next.pageId, range: { anchor: next.from, head: next.to } }];

	installOccurrence(
		{ ...occurrence, steps: occurrence.steps + 1, targets, primaryTarget: targets.length - 1 },
		context,
	);
	editor.focus();
}
