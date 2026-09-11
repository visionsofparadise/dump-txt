import { Copy, Minus, Square, X } from "lucide-react";
import { CloseButton } from "./Window/CloseButton";
import { MaximizeButton } from "./Window/MaximizeButton";
import { MinimizeButton } from "./Window/MinimizeButton";
import type { AppContext } from "../models/AppContext";

interface HeaderBarControlsProps {
	readonly context: AppContext;
}

export function HeaderBarControls({ context }: HeaderBarControlsProps) {
	return (
		<div className="header-bar-controls">
			<MinimizeButton className="header-bar-button" context={context}>
				<Minus size={12} strokeWidth={2.4} aria-hidden />
			</MinimizeButton>
			<MaximizeButton className="header-bar-button" context={context}>
				{(maximized) =>
					maximized ? (
						<Copy size={11} strokeWidth={2.4} aria-hidden />
					) : (
						<Square size={11} strokeWidth={2.4} aria-hidden />
					)
				}
			</MaximizeButton>
			<CloseButton className="header-bar-button" context={context}>
				<X size={12} strokeWidth={2.4} aria-hidden />
			</CloseButton>
		</div>
	);
}
