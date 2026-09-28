import { Minus, Plus, Type } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { DropdownMenuRow, DropdownMenuStepItem } from "../UI/DropdownMenu";
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
		<DropdownMenuRow aria-label="Text size">
			<Type className="size-icon" aria-hidden />
			<span>Text size</span>
			<div className="ml-auto flex items-center">
				<DropdownMenuStepItem
					aria-label="Decrease text size"
					onSelect={decrease}
					disabled={persistenceState.locked || session.appearance.textSize <= 8}
				>
					<Minus className="size-icon" aria-hidden />
				</DropdownMenuStepItem>
				<span className="min-w-10 text-center tabular-nums">{session.appearance.textSize} pt</span>
				<DropdownMenuStepItem
					aria-label="Increase text size"
					onSelect={increase}
					disabled={persistenceState.locked || session.appearance.textSize >= 24}
				>
					<Plus className="size-icon" aria-hidden />
				</DropdownMenuStepItem>
			</div>
		</DropdownMenuRow>
	);
});
