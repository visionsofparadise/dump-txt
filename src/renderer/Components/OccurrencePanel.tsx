import { X } from "lucide-react";
import { scope } from "opshot";
import { useCallback, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { DumpContext } from "../models/DumpContext";

interface OccurrencePanelProps {
	readonly context: DumpContext;
}

export const OccurrencePanel = scope(({ context }: OccurrencePanelProps) => {
	const { session, editor, persistenceState } = context;
	const occurrence = session.view.occurrence;
	const changeMatchCase = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => editor.updateOccurrenceOptions({ matchCase: event.target.checked }),
		[editor],
	);
	const changeAllPages = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => editor.updateOccurrenceOptions({ allPages: event.target.checked }),
		[editor],
	);
	const close = useCallback(() => editor.closeOccurrence(), [editor]);
	const returnEditorFocus = useCallback(
		(event: MouseEvent<HTMLInputElement>) => {
			if (event.detail > 0) editor.focus();
		},
		[editor],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				editor.closeOccurrence();
			} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
				event.preventDefault();
				event.stopPropagation();
				editor.selectNextOccurrence();
			}
		},
		[editor],
	);

	if (!occurrence) return null;

	const pageCount = new Set(occurrence.targets.map((target) => target.pageId)).size;

	return (
		<div
			role="dialog"
			aria-modal="false"
			className="transient-panel occurrence-panel"
			aria-label="Multiple selections"
		>
			<div className="panel-options">
				<label>
					<input
						type="checkbox"
						checked={occurrence.matchCase}
						onKeyDown={handleKeyDown}
						disabled={persistenceState.locked}
						onChange={changeMatchCase}
						onClick={returnEditorFocus}
					/>{" "}
					Match case
				</label>
				<label>
					<input
						type="checkbox"
						checked={occurrence.allPages}
						onKeyDown={handleKeyDown}
						disabled={persistenceState.locked}
						onChange={changeAllPages}
						onClick={returnEditorFocus}
					/>{" "}
					All pages
				</label>
				<button
					className="panel-button"
					type="button"
					aria-label="Close multiple selections"
					onKeyDown={handleKeyDown}
					title="Close multiple selections (Escape)"
					disabled={persistenceState.locked}
					onClick={close}
				>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
			<output className="panel-count" aria-live="polite">
				{occurrence.targets.length} selections · {pageCount} {pageCount === 1 ? "page" : "pages"}
			</output>
		</div>
	);
});
