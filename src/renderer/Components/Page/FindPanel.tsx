import { ArrowDown, ArrowUp, X } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useEffect, useRef, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { findMatches } from "../../utils/findMatches";
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
		(event: ChangeEvent<HTMLInputElement>) => editor.updateFind({ matchCase: event.target.checked }),
		[editor],
	);

	const changeAllPages = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => editor.updateFind({ allPages: event.target.checked }),
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

		document.addEventListener("keydown", focusFind);

		return () => document.removeEventListener("keydown", focusFind);
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
		<div role="dialog" aria-modal="false" className="transient-panel find-panel" aria-label="Find and replace">
			<div className="panel-options">
				<input
					ref={input}
					onKeyDown={handleKeyDown}
					className="panel-input"
					type="text"
					aria-label="Find text"
					placeholder="Find"
					value={session.find.query}
					disabled={disabled}
					onChange={changeQuery}
				/>
				<button
					className="panel-button"
					type="button"
					aria-label="Previous match"
					onKeyDown={handleKeyDown}
					title="Previous match (Shift+Enter)"
					disabled={disabled || matches.length === 0}
					onClick={previousMatch}
				>
					<ArrowUp size={14} aria-hidden="true" />
				</button>
				<button
					className="panel-button"
					type="button"
					aria-label="Next match"
					onKeyDown={handleKeyDown}
					title="Next match (Enter)"
					disabled={disabled || matches.length === 0}
					onClick={nextMatch}
				>
					<ArrowDown size={14} aria-hidden="true" />
				</button>
				<button
					className="panel-button"
					type="button"
					aria-label="Close find"
					onKeyDown={handleKeyDown}
					title="Close find (Escape)"
					onClick={close}
				>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
			<div className="panel-options">
				<input
					className="panel-input"
					type="text"
					aria-label="Replacement text"
					onKeyDown={handleKeyDown}
					placeholder="Replace with"
					value={session.find.replacement}
					disabled={disabled}
					onChange={changeReplacement}
				/>
				<button
					className="panel-button"
					type="button"
					disabled={disabled || matches.length === 0}
					onClick={replace}
					onKeyDown={handleKeyDown}
				>
					Replace
				</button>
				<button
					className="panel-button"
					type="button"
					disabled={disabled || matches.length === 0}
					onClick={replaceAll}
					onKeyDown={handleKeyDown}
				>
					Replace all
				</button>
			</div>
			<div className="panel-options">
				<label>
					<input
						type="checkbox"
						checked={session.find.matchCase}
						onKeyDown={handleKeyDown}
						disabled={disabled}
						onChange={changeMatchCase}
					/>{" "}
					Match case
				</label>
				<label>
					<input
						type="checkbox"
						checked={session.find.allPages}
						onKeyDown={handleKeyDown}
						disabled={disabled}
						onChange={changeAllPages}
					/>{" "}
					All pages
				</label>
				<output className="panel-count" aria-live="polite">
					{matches.length === 0 || session.find.activeMatch < 0
						? `${matches.length} matches`
						: `${Math.min(session.find.activeMatch + 1, matches.length)} of ${matches.length}`}
				</output>
			</div>
		</div>
	);
});
