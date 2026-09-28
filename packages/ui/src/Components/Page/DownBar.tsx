import { ChevronDown, ChevronsDown, Plus, Trash2 } from "lucide-react";
import { scope } from "opshot";
import { useBarControls } from "../../utils/useBarControls";
import { BarButton } from "./BarButton";
import { MoveIcon } from "./MoveIcon";
import { PageBar, PageBarNavigationButton } from "./PageBar";
import type { DumpContext } from "../../models/DumpContext";

interface DownBarProps {
	readonly context: DumpContext;
}

export const DownBar = scope(({ context }: DownBarProps) => {
	const { bar, atEnd, blankEnd, locked, insert, navigate, boundary, move, remove } = useBarControls(context, "down");

	return (
		<PageBar ref={bar} variant="next" aria-label="Next page controls">
			<div className="flex" data-slot="page-bar-leading">
				<BarButton
					label="Insert page below"
					shortcut="Ctrl+N"
					variant="constructive"
					disabled={locked}
					onClick={insert}
				>
					<Plus className="size-icon" aria-hidden />
				</BarButton>
			</div>
			<PageBarNavigationButton
				label="Next page"
				shortcut="Alt+Down"
				bar="next"
				disabled={blankEnd || locked}
				onClick={navigate}
			>
				<ChevronDown className="size-icon" aria-hidden />
			</PageBarNavigationButton>
			<div className="flex">
				<BarButton
					label="Delete page"
					shortcut="Ctrl+Delete"
					variant="destructive"
					disabled={locked}
					onClick={remove}
				>
					<Trash2 className="size-icon" aria-hidden />
				</BarButton>
				<BarButton label="Move page down" disabled={locked} onClick={move}>
					<MoveIcon up={false} />
				</BarButton>
				<BarButton label="Last page" shortcut="Ctrl+End" disabled={atEnd || locked} onClick={boundary}>
					<ChevronsDown className="size-icon" aria-hidden />
				</BarButton>
			</div>
		</PageBar>
	);
});
