import { Copy, Minus, Square, X } from "lucide-react";
import { CloseButton } from "./Window/CloseButton";
import { MaximizeButton } from "./Window/MaximizeButton";
import { MinimizeButton } from "./Window/MinimizeButton";
import type { AppContext } from "../models/AppContext";

interface WindowControlsProps {
	readonly context: AppContext;
}

export function WindowControls({ context }: WindowControlsProps) {
	return (
		<div className="window-controls" data-slot="window-controls">
			<MinimizeButton variant="chrome" context={context}>
				<Minus size={14} aria-hidden />
			</MinimizeButton>
			<MaximizeButton variant="chrome" context={context}>
				{(maximized) => (maximized ? <Copy size={13} aria-hidden /> : <Square size={13} aria-hidden />)}
			</MaximizeButton>
			<CloseButton variant="destructive" context={context}>
				<X size={14} aria-hidden />
			</CloseButton>
		</div>
	);
}
