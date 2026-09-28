import { Paintbrush } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useContext } from "react";
import { PlatformContext } from "../../models/PlatformContext";
import { mobilePlatforms } from "../../utils/platformGroups";
import {
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuShortcut,
} from "../UI/DropdownMenu";
import type { ChromeContext } from "../../models/ChromeContext";

const mobileSubmenuWidth = 160;

const mobileSubmenuStyle = { width: mobileSubmenuWidth };

interface AppearanceMenuProps {
	readonly context: ChromeContext;
}

export const AppearanceMenu = scope(({ context }: AppearanceMenuProps) => {
	const platform = useContext(PlatformContext) ?? context.main.platform;

	const mobile = mobilePlatforms.has(platform ?? "windows");
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
				<Paintbrush className="size-icon" aria-hidden />
				<span>Appearance</span>
				<DropdownMenuShortcut variant="value">
					{session.appearance.theme === "system"
						? "System"
						: session.appearance.theme === "light"
							? "Light"
							: "Dark"}
				</DropdownMenuShortcut>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent
				container={context.surface.current}
				sideOffset={mobile ? -mobileSubmenuWidth : 0}
				style={mobile ? mobileSubmenuStyle : undefined}
			>
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
