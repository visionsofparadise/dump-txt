import { Text } from "@codemirror/state";
import { scope } from "opshot";
import { useMemo } from "react";
import { crossPageSelectionStatusOf, selectionStatusOf, textCountsOf } from "../utils/textStatusOf";
import type { DumpContext } from "../models/DumpContext";

interface StatusBarProps {
	readonly context: DumpContext;
}

export const StatusBar = scope(({ context }: StatusBarProps) => {
	const { document, session } = context;
	const index = document.pages.findIndex((page) => page.id === session.view.activePageId);
	const text = document.pages[index]?.text ?? "";
	const page = useMemo(() => ({ document: Text.of(text.split("\n")), counts: textCountsOf(text) }), [text]);
	const ranges = session.view.selections[session.view.activePageId]?.ranges;
	const targets = session.view.occurrence?.targets;
	const pages = document.pages;
	const crossPageSelection = useMemo(
		() => (targets ? crossPageSelectionStatusOf(pages, targets) : null),
		[pages, targets],
	);
	const pageSelection = useMemo(() => selectionStatusOf(page.document, ranges ?? []), [page, ranges]);
	const selection = crossPageSelection ?? pageSelection;
	const counts = selection.selected ? selection.counts : page.counts;
	const selectionCount = targets?.length ?? ranges?.length ?? 0;
	const selectionLabel =
		targets || selectionCount > 1 ? `${selectionCount} ${selectionCount === 1 ? "selection" : "selections"} · ` : "";
	const countLabel = `${selectionLabel}${counts.characters} chars · ${counts.words} words · ${counts.lines} lines`;

	return (
		<footer className="status-bar" aria-label="Editor status">
			<span className="status-counts" title={`${selection.selected ? "Selected: " : "Page: "}${countLabel}`}>
				{countLabel}
			</span>
			<span className="status-position" title={selection.position}>
				{selection.position}
			</span>
			<span className="page-count" role="status" aria-label={`Page ${index + 1} of ${document.pages.length}`}>
				Pages {index + 1} / {document.pages.length}
			</span>
		</footer>
	);
});
