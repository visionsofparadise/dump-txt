import { StateEffect, type Extension, type StateEffectType, type Text } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { occurrenceMatchesOf, type OccurrenceSeed } from "./occurrenceMatchesOf";
import type { DumpContext } from "../models/DumpContext";
import type { TextMatch, TextRange } from "../models/SessionState";

export const refreshOccurrenceHighlights: StateEffectType<void> = StateEffect.define();

export function createOccurrenceHighlights(
	read: () => { readonly seed: OccurrenceSeed | null; readonly selected: ReadonlyArray<TextRange> },
	context: Pick<DumpContext, "document" | "session">,
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			#document: Text | null = null;
			#key = "";
			#matches: ReadonlyArray<TextMatch> = [];

			constructor(view: EditorView) {
				this.refresh(view);
			}

			update(update: ViewUpdate): void {
				if (
					update.docChanged ||
					update.selectionSet ||
					update.viewportChanged ||
					update.transactions.some((transaction) =>
						transaction.effects.some((effect) => effect.is(refreshOccurrenceHighlights)),
					)
				)
					this.refresh(update.view);
			}

			refresh(view: EditorView): void {
				const { seed, selected } = read();
				const pageId = context.session.view.activePageId;
				const key = JSON.stringify([
					pageId,
					seed?.seed,
					seed?.seedPageId,
					seed?.seedRange.anchor,
					seed?.seedRange.head,
					seed?.matchCase,
					seed?.allPages,
				]);

				if (key !== this.#key || view.state.doc !== this.#document) {
					this.#key = key;
					this.#document = view.state.doc;
					this.#matches =
						seed && Array.from(seed.seed).length > 1
							? occurrenceMatchesOf(seed, {
									document: { pages: [{ id: pageId, text: view.state.doc.toString() }] },
									session: context.session,
								})
							: [];
				}

				const passive = this.#matches.filter(
					(match) =>
						!selected.some(
							(range) =>
								Math.min(range.anchor, range.head) < match.to &&
								Math.max(range.anchor, range.head) > match.from,
						),
				);
				const ranges = [
					...passive.map(({ from, to }) => ({ from, to, className: "cm-occurrence-preview" })),
					...view.state.selection.ranges
						.filter((range) => !range.empty)
						.map(({ from, to }) => ({ from, to, className: "cm-active-selection" })),
				];

				this.decorations = Decoration.set(
					ranges.flatMap(({ from, to, className }) =>
						view.visibleRanges.flatMap((visible) => {
							const start = Math.max(from, visible.from);
							const end = Math.min(to, visible.to);

							return start < end ? [Decoration.mark({ class: className }).range(start, end)] : [];
						}),
					),
					true,
				);
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
