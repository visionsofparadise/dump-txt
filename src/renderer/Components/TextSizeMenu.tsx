import { Type } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import {
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "./UI/DropdownMenu";
import type { DumpContext } from "../models/DumpContext";

interface TextSizeMenuProps {
	readonly context: DumpContext;
}

export const TextSizeMenu = scope(({ context }: TextSizeMenuProps) => {
	const { session, history, persistence, persistenceState } = context;
	const sizeChanged = useCallback(
		(size: string) => {
			if (persistence.state.locked) return;

			const textSize = Number(size);

			if (textSize >= 8 && textSize <= 24) {
				history.closeGroup();
				session.appearance = { ...session.appearance, textSize };
			}
		},
		[history, persistence, session],
	);

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger disabled={persistenceState.locked}>
				<Type size={14} aria-hidden />
				<span>Text size</span>
				<span className="menu-value">{session.appearance.textSize} pt</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<DropdownMenuRadioGroup value={String(session.appearance.textSize)} onValueChange={sizeChanged}>
					{Array.from({ length: 17 }, (_value, index) => index + 8).map((size) => (
						<DropdownMenuRadioItem key={size} value={String(size)} disabled={persistenceState.locked}>
							{size} pt
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
});
