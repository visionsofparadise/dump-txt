import { FileInput, FileOutput } from "lucide-react";
import { scope } from "opshot";
import { useCallback } from "react";
import { DropdownMenuItem } from "../UI/DropdownMenu";
import type { ChromeContext } from "../../models/ChromeContext";

interface PageFileMenuProps {
	readonly context: ChromeContext;
}

export const PageFileMenu = scope(({ context }: PageFileMenuProps) => {
	const { persistence, persistenceState } = context;

	const importPage = useCallback(() => {
		void persistence.importPage();
	}, [persistence]);

	const exportPage = useCallback(() => {
		void persistence.exportPage();
	}, [persistence]);

	return (
		<>
			<DropdownMenuItem onSelect={importPage} disabled={persistenceState.locked}>
				<FileInput size={16} aria-hidden />
				<span>Import page…</span>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={exportPage} disabled={persistenceState.locked}>
				<FileOutput size={16} aria-hidden />
				<span>Export page…</span>
			</DropdownMenuItem>
		</>
	);
});
