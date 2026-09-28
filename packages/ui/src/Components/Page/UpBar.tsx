import { ChevronUp, ChevronsUp, Plus } from "lucide-react";
import { scope } from "opshot";
import { useBarControls } from "../../utils/useBarControls";
import { BarButton } from "./BarButton";
import { MoveIcon } from "./MoveIcon";
import { PageBar, PageBarNavigationButton } from "./PageBar";
import type { DumpContext } from "../../models/DumpContext";
import type { ReactNode } from "react";

interface UpBarProps {
	readonly context: DumpContext;
	readonly children?: ReactNode;
}

export const UpBar = scope(({ context, children }: UpBarProps) => {
	const { bar, atEnd, blankEnd, locked, insert, navigate, boundary, move } = useBarControls(context, "up");

	const variant = children ? "menu" : "previous";

	return (
		<PageBar ref={bar} variant={variant} aria-label="Previous page controls">
			<div className="flex" data-slot="page-bar-leading">
				<BarButton
					label="Insert page above"
					shortcut="Ctrl+Shift+N"
					variant="constructive"
					disabled={locked}
					onClick={insert}
				>
					<Plus className="size-icon" aria-hidden />
				</BarButton>
				{children}
			</div>
			<PageBarNavigationButton
				label="Previous page"
				shortcut="Alt+Up"
				bar={variant}
				disabled={blankEnd || locked}
				onClick={navigate}
			>
				<ChevronUp className="size-icon" aria-hidden />
			</PageBarNavigationButton>
			<div className="flex">
				<BarButton label="Move page up" disabled={locked} onClick={move}>
					<MoveIcon up />
				</BarButton>
				<BarButton label="First page" shortcut="Ctrl+Home" disabled={atEnd || locked} onClick={boundary}>
					<ChevronsUp className="size-icon" aria-hidden />
				</BarButton>
			</div>
		</PageBar>
	);
});
