import { X } from "lucide-react";
import { scope } from "opshot";
import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import { Button } from "../UI/Button";
import { Checkbox } from "../UI/Checkbox";
import { Label } from "../UI/Label";
import { TransientPanel, TransientPanelOptions } from "./TransientPanel";
import type { DumpContext } from "../../models/DumpContext";

interface OccurrencePanelProps {
	readonly context: DumpContext;
}

export const OccurrencePanel = scope(({ context }: OccurrencePanelProps) => {
	const { session, editor, persistenceState } = context;
	const occurrence = session.view.occurrence;

	const changeMatchCase = useCallback(
		(checked: boolean | "indeterminate") => editor.updateOccurrenceOptions({ matchCase: checked === true }),
		[editor],
	);

	const changeAllPages = useCallback(
		(checked: boolean | "indeterminate") => editor.updateOccurrenceOptions({ allPages: checked === true }),
		[editor],
	);

	const close = useCallback(() => editor.closeOccurrence(), [editor]);

	const returnEditorFocus = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
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

	return (
		<TransientPanel data-slot="occurrence-panel" aria-label="Multiple selections">
			<TransientPanelOptions className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_var(--spacing-button)]">
				<Label>
					<Checkbox
						checked={occurrence.matchCase}
						onKeyDown={handleKeyDown}
						disabled={persistenceState.locked}
						onCheckedChange={changeMatchCase}
						onClick={returnEditorFocus}
					/>{" "}
					Match case
				</Label>
				<Label>
					<Checkbox
						checked={occurrence.allPages}
						onKeyDown={handleKeyDown}
						disabled={persistenceState.locked}
						onCheckedChange={changeAllPages}
						onClick={returnEditorFocus}
					/>{" "}
					All pages
				</Label>
				<Button
					variant="panel"
					size="bar"
					type="button"
					aria-label="Close multiple selections"
					onKeyDown={handleKeyDown}
					title="Close multiple selections (Escape)"
					disabled={persistenceState.locked}
					onClick={close}
				>
					<X className="size-icon" aria-hidden="true" />
				</Button>
			</TransientPanelOptions>
		</TransientPanel>
	);
});
