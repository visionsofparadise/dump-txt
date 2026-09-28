import { CaseSensitive } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import { DropdownMenuItem, DropdownMenuShortcut } from "../UI/DropdownMenu";
import type { ChromeContext } from "../../models/ChromeContext";

interface FontMenuProps {
	readonly context: ChromeContext;
}

export const FontMenu = scope(({ context }: FontMenuProps) => {
	const { session, persistenceState, chrome } = context;
	const capabilities = capabilitiesOf(context.main);

	const open = useCallback(() => {
		if (!capabilities.fonts) return;

		chrome.fontPickerOpen = true;
	}, [capabilities.fonts, chrome]);

	return (
		<DropdownMenuItem onSelect={open} disabled={persistenceState.locked || !capabilities.fonts}>
			<CaseSensitive className="size-icon" aria-hidden />
			<span>Font…</span>
			<DropdownMenuShortcut variant="value">{session.appearance.font}</DropdownMenuShortcut>
		</DropdownMenuItem>
	);
});
