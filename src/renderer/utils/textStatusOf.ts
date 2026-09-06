import { Text } from "@codemirror/state";
import type { Page } from "../models/DocumentState";
import type { OccurrenceSession, TextRange } from "../models/SessionState";

export function textCountsOf(text: string) {
	return {
		characters: Array.from(text).length,
		words: text.match(/\S+/gu)?.length ?? 0,
		lines: text.split("\n").length,
	};
}

export function selectionStatusOf(document: Text, ranges: ReadonlyArray<TextRange>) {
	const ordered = ranges
		.map(({ anchor, head }) => ({ from: Math.min(anchor, head), to: Math.max(anchor, head) }))
		.sort((left, right) => left.from - right.from);
	let characters = 0;
	let words = 0;
	let lines = 0;
	let lastLine = 0;
	let selected = false;

	for (const { from, to } of ordered) {
		if (from === to) continue;

		selected = true;

		const counts = textCountsOf(document.sliceString(from, to));
		const startLine = document.lineAt(from).number;
		const endLine = document.lineAt(to - 1).number;

		characters += counts.characters;
		words += counts.words;
		lines += Math.max(0, endLine - Math.max(lastLine + 1, startLine) + 1);
		lastLine = Math.max(lastLine, endLine);
	}

	const positionOf = (offset: number) => {
		const line = document.lineAt(offset);

		return `Ln ${line.number}, Col ${Array.from(document.sliceString(line.from, offset)).length + 1}`;
	};
	const from = ordered[0]?.from ?? 0;
	const to = ordered.reduce((end, range) => Math.max(end, range.to), from);

	return {
		selected,
		counts: { characters, words, lines },
		start: positionOf(from),
		end: positionOf(to),
		position: from === to ? positionOf(from) : `${positionOf(from)} – ${positionOf(to)}`,
	};
}

export function crossPageSelectionStatusOf(pages: ReadonlyArray<Page>, targets: OccurrenceSession["targets"]) {
	const selections = pages.flatMap((page, index) => {
		const ranges = targets.filter((target) => target.pageId === page.id).map((target) => target.range);

		return ranges.length ? [{ page: index + 1, ...selectionStatusOf(Text.of(page.text.split("\n")), ranges) }] : [];
	});
	const first = selections[0];
	const last = selections.at(-1);

	if (!first || !last || first === last) return null;

	return {
		selected: selections.some((selection) => selection.selected),
		counts: selections.reduce(
			(total, selection) => ({
				characters: total.characters + selection.counts.characters,
				words: total.words + selection.counts.words,
				lines: total.lines + selection.counts.lines,
			}),
			{ characters: 0, words: 0, lines: 0 },
		),
		position: `Pg ${first.page}, ${first.start} – Pg ${last.page}, ${last.end}`,
	};
}
