import { ChangeSet, Text } from "@codemirror/state";
import { freezePages, type DocumentState, type Page, type PreparedEdit } from "../models/DocumentState";
import {
	snapshotView,
	type PageSelection,
	type SessionState,
	type TextRange,
	type ViewSnapshot,
} from "../models/SessionState";
import { normalizeFormFeeds } from "./normalizeFormFeeds";
import { parsePages } from "./parsePages";
import { preparePageMove } from "./preparePageMove";
import type { EditCommand } from "../models/EditCommand";

export interface PageChange {
	readonly pageId: string;
	readonly changes: ReadonlyArray<{ readonly from: number; readonly to: number; readonly insert: string }>;
	readonly ranges?: ReadonlyArray<TextRange>;
}

const enclosures: Readonly<Record<string, string>> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"<": ">",
	"'": "'",
	'"': '"',
	"`": "`",
};

function orderedRanges(ranges: ReadonlyArray<TextRange>, length: number): ReadonlyArray<TextRange> {
	const sorted = ranges
		.map(({ anchor, head }) => ({
			anchor: Math.max(0, Math.min(length, anchor)),
			head: Math.max(0, Math.min(length, head)),
		}))
		.sort((left, right) => Math.min(left.anchor, left.head) - Math.min(right.anchor, right.head));
	const result: Array<TextRange> = [];

	for (const range of sorted) {
		const previous = result.at(-1);

		if (
			previous &&
			(Math.min(range.anchor, range.head) < Math.max(previous.anchor, previous.head) ||
				(range.anchor === range.head && previous.anchor === range.anchor && previous.head === range.head))
		) {
			result[result.length - 1] = {
				anchor: Math.min(previous.anchor, previous.head, range.anchor, range.head),
				head: Math.max(previous.anchor, previous.head, range.anchor, range.head),
			};
		} else result.push(range);
	}

	return result;
}

export function participatingRanges(
	document: DocumentState,
	view: ViewSnapshot,
): ReadonlyMap<string, ReadonlyArray<TextRange>> {
	const grouped = new Map<string, Array<TextRange>>();

	if (view.occurrence) {
		for (const target of view.occurrence.targets) {
			const ranges = grouped.get(target.pageId) ?? [];

			ranges.push(target.range);
			grouped.set(target.pageId, ranges);
		}
	} else grouped.set(view.activePageId, [...(view.selections[view.activePageId]?.ranges ?? [{ anchor: 0, head: 0 }])]);

	return new Map(
		[...grouped].map(([pageId, ranges]) => [
			pageId,
			orderedRanges(ranges, document.pages.find((page) => page.id === pageId)?.text.length ?? 0),
		]),
	);
}

function adjacentGrapheme(text: string, position: number, direction: "backward" | "forward"): number {
	const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
	const segment = segments.containing(direction === "backward" ? position - 1 : position);

	return segment
		? segment.index + (direction === "forward" ? segment.segment.length : 0)
		: direction === "backward"
			? 0
			: text.length;
}

function touchedLines(text: string, range: TextRange): Array<number> {
	const from = Math.min(range.anchor, range.head);
	const to = Math.max(range.anchor, range.head);
	const result = [from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1];

	for (let index = text.indexOf("\n", from); index >= 0 && index + 1 < to; index = text.indexOf("\n", index + 1))
		result.push(index + 1);

	return result;
}

function changesFor(
	page: Page,
	ranges: ReadonlyArray<TextRange>,
	command: Exclude<
		EditCommand,
		{ type: "insertPage" } | { type: "deletePage" } | { type: "movePage" } | { type: "replace" }
	>,
): PageChange {
	const changes: Array<{ from: number; to: number; insert: string }> = [];
	const desired: Array<TextRange> = [];

	if (command.type === "indent") {
		const lineStarts = new Set<number>();

		for (const range of ranges) {
			if (
				command.direction === "in" &&
				!page.text.slice(Math.min(range.anchor, range.head), Math.max(range.anchor, range.head)).includes("\n")
			) {
				changes.push({
					from: Math.min(range.anchor, range.head),
					to: Math.max(range.anchor, range.head),
					insert: "\t",
				});
			} else for (const start of touchedLines(page.text, range)) lineStarts.add(start);
		}

		for (const start of lineStarts)
			changes.push({
				from: start,
				to:
					command.direction === "in"
						? start
						: start + (/^(?:\t| {1,4})/u.exec(page.text.slice(start))?.[0].length ?? 0),
				insert: command.direction === "in" ? "\t" : "",
			});

		changes.sort((left, right) => left.from - right.from);

		const changeSet = ChangeSet.of(changes, page.text.length);

		return {
			pageId: page.id,
			changes,
			ranges: ranges.map((range) => ({
				anchor: changeSet.mapPos(range.anchor, 1),
				head: changeSet.mapPos(range.head, 1),
			})),
		};
	}

	let displacement = 0;

	for (const range of ranges) {
		let from = Math.min(range.anchor, range.head);
		let to = Math.max(range.anchor, range.head);
		let insert = "";
		let inner = false;

		if (command.type === "delete") {
			if (from === to) {
				if (command.direction === "backward") from = adjacentGrapheme(page.text, from, command.direction);
				else to = adjacentGrapheme(page.text, to, command.direction);
			}
		} else if (command.type === "enclose") {
			inner = from !== to && Object.hasOwn(enclosures, command.opening);
			insert = inner
				? command.opening + page.text.slice(from, to) + (enclosures[command.opening] ?? "")
				: command.opening;
		} else insert = command.text.replace(/\r\n?|\n/gu, "\n");

		changes.push({ from, to, insert });

		const start = from + displacement;

		if (inner)
			desired.push(
				range.anchor > range.head
					? { anchor: start + insert.length - 1, head: start + 1 }
					: { anchor: start + 1, head: start + insert.length - 1 },
			);
		else desired.push({ anchor: start + insert.length, head: start + insert.length });

		displacement += insert.length - (to - from);
	}

	return { pageId: page.id, changes, ranges: desired };
}

function normalizedOffset(text: string, offset: number): number {
	let result = offset;

	for (let index = 0; index < text.length; index++) {
		if (text[index] !== "\f") continue;

		if (index <= offset && text[index - 1] !== "\n") result++;

		if (index < offset && text[index + 1] !== "\n") result++;
	}

	return result;
}

function splitPosition(text: string, pages: ReadonlyArray<Page>, offset: number): { pageId: string; offset: number } {
	const first = pages[0];

	if (pages.length === 1 && first)
		return { pageId: first.id, offset: Math.max(0, Math.min(first.text.length, offset)) };

	const normalized = normalizeFormFeeds(text);
	const position = normalizedOffset(text, offset);
	let pageIndex = 0;
	let start = 0;

	for (let separator = normalized.indexOf("\f"); separator >= 0; separator = normalized.indexOf("\f", separator + 1)) {
		if (position <= separator - 1) break;

		pageIndex++;
		start = separator + 2;
	}

	const page = pages[Math.min(pageIndex, pages.length - 1)];

	if (!page) throw new Error("An edit requires a destination page.");

	return { pageId: page.id, offset: Math.max(0, Math.min(page.text.length, position - start)) };
}

export function prepareChanges(
	changes: ReadonlyArray<PageChange>,
	document: DocumentState,
	session: SessionState,
	group: string | null = null,
): PreparedEdit {
	const before = snapshotView(session.view);
	const selections: Record<string, PageSelection> = { ...before.selections };
	const pages: Array<Page> = [];
	const targets: Array<{ pageId: string; range: TextRange }> = [];
	let activePageId = before.activePageId;
	let primaryTarget = 0;
	const primary = before.occurrence?.targets[before.occurrence.primaryTarget];

	for (const page of document.pages) {
		const edit = changes.find((candidate) => candidate.pageId === page.id);

		if (!edit) {
			pages.push(page);

			continue;
		}

		const changeSet = ChangeSet.of(edit.changes, page.text.length);
		const text = changeSet.apply(Text.of(page.text.split("\n"))).toString();
		const fragments = text.includes("\f")
			? parsePages(text).map((fragment, index) => ({ ...fragment, id: index === 0 ? page.id : fragment.id }))
			: [text === page.text ? page : { id: page.id, text }];

		pages.push(...fragments);

		const priorSelection = before.selections[page.id];
		const ranges =
			edit.ranges ??
			(priorSelection?.ranges ?? [{ anchor: 0, head: 0 }]).map((range) => ({
				anchor: changeSet.mapPos(range.anchor, 1),
				head: changeSet.mapPos(range.head, 1),
			}));

		for (const fragment of fragments)
			selections[fragment.id] = {
				ranges: [{ anchor: 0, head: 0 }],
				mainIndex: 0,
				scrollTop: fragment.id === page.id ? (priorSelection?.scrollTop ?? 0) : 0,
			};

		const mapped = new Map<string, Array<TextRange>>();

		for (const [rangeIndex, range] of ranges.entries()) {
			const anchor = splitPosition(text, fragments, range.anchor);
			const head = splitPosition(text, fragments, range.head);
			const mappedRange = { anchor: anchor.pageId === head.pageId ? anchor.offset : head.offset, head: head.offset };
			const fragmentRanges = mapped.get(head.pageId) ?? [];

			fragmentRanges.push(mappedRange);
			mapped.set(head.pageId, fragmentRanges);

			const isPrimary =
				page.id === (primary?.pageId ?? before.activePageId) &&
				rangeIndex ===
					(primary
						? (participatingRanges(document, before).get(page.id) ?? []).findIndex(
								(candidate) =>
									Math.min(candidate.anchor, candidate.head) <=
										Math.min(primary.range.anchor, primary.range.head) &&
									Math.max(candidate.anchor, candidate.head) >=
										Math.max(primary.range.anchor, primary.range.head),
							)
						: (priorSelection?.mainIndex ?? 0));

			if (isPrimary) {
				activePageId = head.pageId;
				primaryTarget = targets.length;
			}

			if (before.occurrence) targets.push({ pageId: head.pageId, range: mappedRange });
		}

		for (const [pageId, mappedRanges] of mapped)
			selections[pageId] = {
				ranges: mappedRanges,
				mainIndex: Math.min(priorSelection?.mainIndex ?? 0, mappedRanges.length - 1),
				scrollTop: selections[pageId]?.scrollTop ?? 0,
			};
	}

	const occurrence = before.occurrence ? { ...before.occurrence, targets, primaryTarget } : null;

	return {
		pages:
			pages.length === document.pages.length && pages.every((page, index) => page === document.pages[index])
				? document.pages
				: freezePages(pages),
		before,
		after: snapshotView({ activePageId, selections, occurrence }),
		group,
	};
}

export function prepareEdit(command: EditCommand, document: DocumentState, session: SessionState): PreparedEdit {
	if (command.type === "movePage") return preparePageMove(command.direction, document, session);

	const before = snapshotView(session.view);
	const activeIndex = document.pages.findIndex((page) => page.id === before.activePageId);

	if (command.type === "insertPage" || command.type === "deletePage") {
		const pages = [...document.pages];
		const selections = { ...before.selections };
		let activePageId: string;

		if (command.type === "insertPage") {
			const page = { id: crypto.randomUUID(), text: "" };

			pages.splice(activeIndex + (command.position === "below" ? 1 : 0), 0, page);
			activePageId = page.id;
			selections[page.id] = { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 };
		} else {
			pages.splice(activeIndex, 1);
			Reflect.deleteProperty(selections, before.activePageId);

			if (!pages.length) pages.push({ id: crypto.randomUUID(), text: "" });

			const destination = pages[Math.min(activeIndex, pages.length - 1)];

			if (!destination) throw new Error("Page deletion requires a destination.");

			activePageId = destination.id;
			selections[activePageId] ??= { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0, scrollTop: 0 };
		}

		return {
			pages: freezePages(pages),
			before,
			after: snapshotView({ activePageId, selections, occurrence: null }),
			group: null,
		};
	}

	if (command.type === "replace") {
		const changes = document.pages
			.map((page) => ({
				pageId: page.id,
				changes: command.matches
					.filter((match) => match.pageId === page.id)
					.map((match) => ({ from: match.from, to: match.to, insert: command.text.replace(/\r\n?/gu, "\n") })),
			}))
			.filter((edit) => edit.changes.length > 0);

		return prepareChanges(changes, document, session);
	}

	const changes = [...participatingRanges(document, before)].flatMap(([pageId, ranges]) => {
		const page = document.pages.find((candidate) => candidate.id === pageId);

		return page ? [changesFor(page, ranges, command)] : [];
	});

	return prepareChanges(changes, document, session);
}
