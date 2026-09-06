import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Plus, Trash2 } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "../utils/cn";
import type { DumpContext } from "../models/DumpContext";

interface PageBarProps {
	readonly position: "top" | "bottom";
	readonly context: DumpContext;
}

export const PageBar = scope(({ position, context }: PageBarProps) => {
	const { document, session, editor, persistenceState } = context;
	const bar = useRef<HTMLElement>(null);

	useEffect(() => {
		const element = bar.current;
		const wheel = (event: WheelEvent) => editor.handleWheel(event, "bar");

		element?.addEventListener("wheel", wheel, { passive: false });

		return () => element?.removeEventListener("wheel", wheel);
	}, [editor]);

	const index = document.pages.findIndex((page) => page.id === session.view.activePageId);
	const top = position === "top";
	const atEnd = top ? index === 0 : index === document.pages.length - 1;
	const insert = useCallback(() => {
		editor.apply({ type: "insertPage", position: top ? "above" : "below" });
		editor.focus();
	}, [editor, top]);
	const navigate = useCallback(() => {
		const page = document.pages[index + (top ? -1 : 1)];

		if (page) editor.showPage(page.id);
	}, [document, editor, index, top]);
	const boundary = useCallback(() => {
		const page = top ? document.pages[0] : document.pages.at(-1);

		if (page) editor.showPage(page.id);
	}, [document, editor, top]);
	const remove = useCallback(() => {
		editor.apply({ type: "deletePage" });
		editor.focus();
	}, [editor]);
	const insertionLabel = top ? "Insert page above" : "Insert page below";
	const navigationLabel = top ? "Previous page" : "Next page";
	const shortcut = top ? "Alt+Up" : "Alt+Down";

	return (
		<nav
			ref={bar}
			className={cn("page-bar", !top && "page-bar-bottom")}
			aria-label={top ? "Previous page controls" : "Next page controls"}
		>
			<div className="page-bar-leading">
				<button
					className="chrome-button"
					title={`${insertionLabel} (${top ? "Ctrl+Shift+N" : "Ctrl+N"})`}
					aria-label={insertionLabel}
					disabled={persistenceState.locked}
					onClick={insert}
				>
					<Plus size={16} aria-hidden />
				</button>
			</div>
			<button
				className={cn("page-nav-main", atEnd && "page-nav-hidden")}
				aria-label={navigationLabel}
				title={`${navigationLabel} (${shortcut})`}
				aria-hidden={atEnd}
				tabIndex={atEnd ? -1 : undefined}
				disabled={atEnd || persistenceState.locked}
				onClick={navigate}
			>
				{top ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
			</button>
			<div className="page-bar-trailing">
				{!top && (
					<button
						className="chrome-button"
						aria-label="Delete page"
						title="Delete page (Ctrl+Delete)"
						disabled={persistenceState.locked}
						onClick={remove}
					>
						<Trash2 size={15} aria-hidden />
					</button>
				)}
				<button
					className="chrome-button"
					aria-label={top ? "First page" : "Last page"}
					title={top ? "First page (Ctrl+Home)" : "Last page (Ctrl+End)"}
					disabled={atEnd || persistenceState.locked}
					onClick={boundary}
				>
					{top ? <ChevronsUp size={16} aria-hidden /> : <ChevronsDown size={16} aria-hidden />}
				</button>
			</div>
		</nav>
	);
});
