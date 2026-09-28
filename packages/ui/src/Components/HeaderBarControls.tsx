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
		<div className="header-bar-controls" data-slot="header-bar-controls">
			<MinimizeButton variant="gnome" context={context}>
				<Minus size={12} strokeWidth={2.4} aria-hidden />
			</MinimizeButton>
			<MaximizeButton variant="gnome" context={context}>
				{(maximized) =>
					maximized ? (
						<Copy size={11} strokeWidth={2.4} aria-hidden />
					) : (
						<Square size={11} strokeWidth={2.4} aria-hidden />
					)
				}
			</MaximizeButton>
			<CloseButton variant="gnome" context={context}>
				<X size={12} strokeWidth={2.4} aria-hidden />
			</CloseButton>
		</div>
	);
}
