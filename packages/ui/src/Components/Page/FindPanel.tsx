import { ArrowDown, ArrowUp, X } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useEffect, useRef, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { findMatches } from "../../utils/findMatches";
import { Button } from "../UI/Button";
import { Checkbox } from "../UI/Checkbox";
import { Input } from "../UI/Input";
import { Label } from "../UI/Label";
import { TransientPanel, TransientPanelOptions } from "./TransientPanel";
import type { DumpContext } from "../../models/DumpContext";

interface FindPanelProps {
	readonly context: DumpContext;
}

export const FindPanel = scope(({ context }: FindPanelProps) => {
	const { session, editor, persistenceState } = context;

	const input = useRef<HTMLInputElement>(null);

	const open = session.find.open;

	const changeQuery = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => editor.updateFind({ query: event.target.value }),
		[editor],
	);

	const changeReplacement = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => editor.updateFind({ replacement: event.target.value }),
		[editor],
	);

	const changeMatchCase = useCallback(
		(checked: boolean | "indeterminate") => editor.updateFind({ matchCase: checked === true }),
		[editor],
	);

	const changeAllPages = useCallback(
		(checked: boolean | "indeterminate") => editor.updateFind({ allPages: checked === true }),
		[editor],
	);

	const previousMatch = useCallback(() => editor.nextFind(-1), [editor]);

	const nextMatch = useCallback(() => editor.nextFind(1), [editor]);

	const close = useCallback(() => editor.closeFind(), [editor]);

	const replace = useCallback(() => editor.replaceFind(false), [editor]);

	const replaceAll = useCallback(() => editor.replaceFind(true), [editor]);

	useEffect(() => {
		if (!open) return;

		input.current?.focus();
		input.current?.select();

		const focusFind = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
				input.current?.focus();
				input.current?.select();
			}
		};

		const surface = input.current?.closest<HTMLElement>('[data-slot="dump-ui"]');

		surface?.addEventListener("keydown", focusFind);

		return () => surface?.removeEventListener("keydown", focusFind);
	}, [open]);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				editor.closeFind();
			} else if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "text") {
				event.preventDefault();
				editor.nextFind(event.shiftKey ? -1 : 1);
			}
		},
		[editor],
	);

	if (!open) return null;

	const matches = findMatches(session.find, context);
	const disabled = persistenceState.locked;

	return (
		<TransientPanel className="grid" data-slot="find-panel" aria-label="Find and replace">
			<TransientPanelOptions>
				<Input
					ref={input}
					onKeyDown={handleKeyDown}
					variant="panel"
					type="text"
					aria-label="Find text"
					placeholder="Find"
					value={session.find.query}
					disabled={disabled}
					onChange={changeQuery}
				/>
				<Button
					variant="panel"
					size="icon"
					type="button"
					aria-label="Previous match"
					onKeyDown={handleKeyDown}
					title="Previous match (Shift+Enter)"
					disabled={disabled || matches.length === 0}
					onClick={previousMatch}
				>
					<ArrowUp className="size-icon" aria-hidden="true" />
				</Button>
				<Button
					variant="panel"
					size="icon"
					type="button"
					aria-label="Next match"
					onKeyDown={handleKeyDown}
					title="Next match (Enter)"
					disabled={disabled || matches.length === 0}
					onClick={nextMatch}
				>
					<ArrowDown className="size-icon" aria-hidden="true" />
				</Button>
				<Button
					variant="panel"
					size="icon"
					type="button"
					aria-label="Close find"
					onKeyDown={handleKeyDown}
					title="Close find (Escape)"
					onClick={close}
				>
					<X className="size-icon" aria-hidden="true" />
				</Button>
			</TransientPanelOptions>
			<TransientPanelOptions>
				<Input
					variant="panel"
					type="text"
					aria-label="Replacement text"
					onKeyDown={handleKeyDown}
					placeholder="Replace with"
					value={session.find.replacement}
					disabled={disabled}
					onChange={changeReplacement}
				/>
				<Button
					variant="panel"
					size="bar"
					type="button"
					disabled={disabled || matches.length === 0}
					onClick={replace}
					onKeyDown={handleKeyDown}
				>
					Replace
				</Button>
				<Button
					variant="panel"
					size="bar"
					type="button"
					disabled={disabled || matches.length === 0}
					onClick={replaceAll}
					onKeyDown={handleKeyDown}
				>
					Replace all
				</Button>
			</TransientPanelOptions>
			<TransientPanelOptions>
				<Label>
					<Checkbox
						checked={session.find.matchCase}
						onKeyDown={handleKeyDown}
						disabled={disabled}
						onCheckedChange={changeMatchCase}
					/>{" "}
					Match case
				</Label>
				<Label>
					<Checkbox
						checked={session.find.allPages}
						onKeyDown={handleKeyDown}
						disabled={disabled}
						onCheckedChange={changeAllPages}
					/>{" "}
					All pages
				</Label>
				<output
					className="ml-auto pr-3 text-secondary whitespace-nowrap text-popover-muted-foreground tabular-nums"
					aria-live="polite"
				>
					{matches.length === 0 || session.find.activeMatch < 0
						? `${matches.length} matches`
						: `${Math.min(session.find.activeMatch + 1, matches.length)} of ${matches.length}`}
				</output>
			</TransientPanelOptions>
		</TransientPanel>
	);
});
