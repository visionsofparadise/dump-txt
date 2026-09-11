import { FileInput, FileOutput } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import { DropdownMenuItem } from "../UI/DropdownMenu";
import type { ChromeContext } from "../../models/ChromeContext";

interface PageFileMenuProps {
	readonly context: ChromeContext;
}

export const PageFileMenu = scope(({ context }: PageFileMenuProps) => {
	const { persistence, persistenceState } = context;
	const capabilities = capabilitiesOf(context.main);

	const importPage = useCallback(() => {
		if (!capabilities.importPage) return;

		void persistence.importPage();
	}, [capabilities.importPage, persistence]);

	const exportPage = useCallback(() => {
		if (!capabilities.exportPage) return;

		void persistence.exportPage();
	}, [capabilities.exportPage, persistence]);

	return (
		<>
			<DropdownMenuItem onSelect={importPage} disabled={persistenceState.locked || !capabilities.importPage}>
				<FileInput size={16} aria-hidden />
				<span>Import page…</span>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={exportPage} disabled={persistenceState.locked || !capabilities.exportPage}>
				<FileOutput size={16} aria-hidden />
				<span>Export page…</span>
			</DropdownMenuItem>
		</>
	);
});
