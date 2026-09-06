import { CaseSensitive } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { DropdownMenuItem } from "./UI/DropdownMenu";
import type { ChromeContext } from "../models/ChromeContext";

interface FontMenuProps {
	readonly context: ChromeContext;
}

export const FontMenu = scope(({ context }: FontMenuProps) => {
	const { session, persistenceState, chrome } = context;
	const open = useCallback(() => {
		chrome.fontPickerOpen = true;
	}, [chrome]);

	return (
		<DropdownMenuItem onSelect={open} disabled={persistenceState.locked}>
			<CaseSensitive size={16} aria-hidden />
			<span>Font…</span>
			<span className="menu-value">{session.appearance.font}</span>
		</DropdownMenuItem>
	);
});
