import { ChevronUp, ChevronsUp, Plus } from "lucide-react";
import { scope } from "opshot";
import { useBarControls } from "../../utils/useBarControls";
import { BarButton } from "./BarButton";
import { MoveIcon } from "./MoveIcon";
import type { DumpContext } from "../../models/DumpContext";

interface UpBarProps {
	readonly context: DumpContext;
}

export const UpBar = scope(({ context }: UpBarProps) => {
	const { bar, atEnd, locked, insert, navigate, boundary, move } = useBarControls(context, "up");

	return (
		<nav ref={bar} className="page-bar" aria-label="Previous page controls">
			<div className="page-bar-leading">
				<BarButton
					label="Insert page above"
					shortcut="Ctrl+Shift+N"
					className="chrome-button page-insert"
					disabled={locked}
					onClick={insert}
				>
					<Plus size={16} aria-hidden />
				</BarButton>
			</div>
			<BarButton
				label="Previous page"
				shortcut="Alt+Up"
				className="page-nav-main"
				hidden={atEnd}
				disabled={atEnd || locked}
				onClick={navigate}
			>
				<ChevronUp size={16} aria-hidden />
			</BarButton>
			<div className="page-bar-trailing">
				<BarButton label="Move page up" disabled={locked} onClick={move}>
					<MoveIcon up />
				</BarButton>
				<BarButton label="First page" shortcut="Ctrl+Home" disabled={atEnd || locked} onClick={boundary}>
					<ChevronsUp size={16} aria-hidden />
				</BarButton>
			</div>
		</nav>
	);
});
