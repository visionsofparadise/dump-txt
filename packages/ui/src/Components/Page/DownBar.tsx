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
	const { bar, atEnd, locked, insert, navigate, boundary, move, remove } = useBarControls(context, "down");

	return (
		<nav ref={bar} className="page-bar page-bar-bottom" aria-label="Next page controls">
			<div className="page-bar-leading">
				<BarButton
					label="Insert page below"
					shortcut="Ctrl+N"
					className="chrome-button page-insert"
					disabled={locked}
					onClick={insert}
				>
					<Plus size={16} aria-hidden />
				</BarButton>
			</div>
			<BarButton
				label="Next page"
				shortcut="Alt+Down"
				className="page-nav-main"
				hidden={atEnd}
				disabled={atEnd || locked}
				onClick={navigate}
			>
				<ChevronDown size={16} aria-hidden />
			</BarButton>
			<div className="page-bar-trailing">
				<BarButton
					label="Delete page"
					shortcut="Ctrl+Delete"
					className="chrome-button page-delete"
					disabled={locked}
					onClick={remove}
				>
					<Trash2 size={15} aria-hidden />
				</BarButton>
				<BarButton label="Move page down" disabled={locked} onClick={move}>
					<MoveIcon up={false} />
				</BarButton>
				<BarButton label="Last page" shortcut="Ctrl+End" disabled={atEnd || locked} onClick={boundary}>
					<ChevronsDown size={16} aria-hidden />
				</BarButton>
			</div>
		</nav>
	);
});
