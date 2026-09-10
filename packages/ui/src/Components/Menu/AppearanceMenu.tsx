import { Paintbrush } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import {
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "../UI/DropdownMenu";
import type { ChromeContext } from "../../models/ChromeContext";

interface AppearanceMenuProps {
	readonly context: ChromeContext;
}

export const AppearanceMenu = scope(({ context }: AppearanceMenuProps) => {
	const { session, history, persistence, persistenceState } = context;

	const themeChanged = useCallback(
		(theme: string) => {
			if (persistence.state.locked) return;

			if (theme === "system" || theme === "light" || theme === "dark") {
				history.closeGroup();
				session.appearance = { ...session.appearance, theme };
			}
		},
		[history, persistence, session],
	);

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger disabled={persistenceState.locked}>
				<Paintbrush size={14} aria-hidden />
				<span>Appearance</span>
				<span className="menu-value">
					{session.appearance.theme === "system"
						? "System"
						: session.appearance.theme === "light"
							? "Light"
							: "Dark"}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent container={context.surface.current}>
				<DropdownMenuRadioGroup value={session.appearance.theme} onValueChange={themeChanged}>
					<DropdownMenuRadioItem value="system" disabled={persistenceState.locked}>
						System
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="light" disabled={persistenceState.locked}>
						Light
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark" disabled={persistenceState.locked}>
						Dark
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
});
