import { Minus, Plus, Type } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { DropdownMenuStepItem } from "../UI/DropdownMenu";
import type { DumpContext } from "../../models/DumpContext";

interface TextSizeMenuProps {
	readonly context: DumpContext;
}

export const TextSizeMenu = scope(({ context }: TextSizeMenuProps) => {
	const { session, history, persistence, persistenceState } = context;

	const sizeChanged = useCallback(
		(change: number) => {
			if (persistence.state.locked) return;

			const textSize = session.appearance.textSize + change;

			if (textSize >= 8 && textSize <= 24) {
				history.closeGroup();
				session.appearance = { ...session.appearance, textSize };
			}
		},
		[history, persistence, session],
	);

	const decrease = useCallback(
		(event: Event) => {
			event.preventDefault();
			sizeChanged(-1);
		},
		[sizeChanged],
	);

	const increase = useCallback(
		(event: Event) => {
			event.preventDefault();
			sizeChanged(1);
		},
		[sizeChanged],
	);

	return (
		<div className="menu-size-row" role="group" aria-label="Text size">
			<Type className="size-icon" aria-hidden />
			<span>Text size</span>
			<div className="menu-size-controls">
				<DropdownMenuStepItem
					aria-label="Decrease text size"
					onSelect={decrease}
					disabled={persistenceState.locked || session.appearance.textSize <= 8}
				>
					<Minus className="size-icon" aria-hidden />
				</DropdownMenuStepItem>
				<span className="menu-size-value">{session.appearance.textSize} pt</span>
				<DropdownMenuStepItem
					aria-label="Increase text size"
					onSelect={increase}
					disabled={persistenceState.locked || session.appearance.textSize >= 24}
				>
					<Plus className="size-icon" aria-hidden />
				</DropdownMenuStepItem>
			</div>
		</div>
	);
});
