import { ChevronDown, ChevronsDown, Plus, Trash2 } from "lucide-react";
import { scope } from "opshot";
import { useBarControls } from "../../utils/useBarControls";
import { BarButton } from "./BarButton";
import { MoveIcon } from "./MoveIcon";
import type { DumpContext } from "../../models/DumpContext";

interface DownBarProps {
	readonly context: DumpContext;
}

export const DownBar = scope(({ context }: DownBarProps) => {
	const { bar, atEnd, blankEnd, locked, insert, navigate, boundary, move, remove } = useBarControls(context, "down");

	return (
		<nav ref={bar} className="page-bar page-bar-bottom" data-slot="page-bar" aria-label="Next page controls">
			<div className="page-bar-leading" data-slot="page-bar-leading">
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
			<BarButton
				label="Next page"
				shortcut="Alt+Down"
				variant="nav"
				offset="two"
				disabled={blankEnd || locked}
				onClick={navigate}
			>
				<ChevronDown className="size-icon" aria-hidden />
			</BarButton>
			<div className="page-bar-trailing">
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
		</nav>
	);
});
