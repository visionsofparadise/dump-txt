import { scope } from "opshot";
import { useCallback } from "react";
import type { AppContext } from "../models/AppContext";

interface SaveStatusProps {
	readonly context: AppContext;
}

export const SaveStatus = scope(({ context }: SaveStatusProps) => {
	const { persistence, persistenceState } = context;
	const retry = useCallback(() => {
		void persistence.flush().catch(() => undefined);
	}, [persistence]);
	const saveAs = useCallback(() => {
		void persistence.saveAs().catch(() => undefined);
	}, [persistence]);
	const open = useCallback(() => {
		void persistence.open().catch(() => undefined);
	}, [persistence]);

	if (!persistenceState.error) return null;

	return (
		<div
			role="status"
			aria-live="polite"
			className="flex flex-wrap items-center justify-between gap-2 border-b border-current bg-bar px-3 py-2 text-xs"
		>
			<span>{persistenceState.error}</span>
			<div className="flex shrink-0 gap-3">
				<button onClick={retry}>Retry</button>
				<button onClick={saveAs}>Save As…</button>
				<button onClick={open}>Open…</button>
			</div>
		</div>
	);
});
