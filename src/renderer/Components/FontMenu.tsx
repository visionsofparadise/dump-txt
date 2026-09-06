import { CaseSensitive } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { FontMenuItem } from "./FontMenuItem";
import {
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
} from "./UI/DropdownMenu";
import type { DumpContext } from "../models/DumpContext";

interface FontMenuProps {
	readonly context: DumpContext;
}

export const FontMenu = scope(({ context }: FontMenuProps) => {
	const { session, history, persistence, persistenceState } = context;
	const fontChanged = useCallback(
		(font: string) => {
			if (persistence.state.locked) return;

			history.closeGroup();
			session.appearance = { ...session.appearance, font };
		},
		[history, persistence, session],
	);

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger disabled={persistenceState.locked}>
				<CaseSensitive size={14} aria-hidden />
				<span>Font</span>
				<span className="menu-value">{session.appearance.font}</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<DropdownMenuRadioGroup value={session.appearance.font} onValueChange={fontChanged}>
					{[
						"Consolas",
						"Cascadia Mono",
						"Segoe UI",
						"Calibri",
						"Arial",
						"Verdana",
						"Tahoma",
						"Georgia",
						"Cambria",
						"Times New Roman",
						"Courier New",
					].map((font) => (
						<FontMenuItem key={font} font={font} disabled={persistenceState.locked} />
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
});
