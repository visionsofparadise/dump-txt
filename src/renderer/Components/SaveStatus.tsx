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
		<div role="status" aria-live="polite" className="save-error">
			<span>{persistenceState.error}</span>
			<div className="save-error-actions">
				<button className="panel-button" disabled={persistenceState.locked} onClick={retry}>
					Retry
				</button>
				<button className="panel-button" disabled={persistenceState.locked} onClick={saveAs}>
					Save As…
				</button>
				<button className="panel-button" disabled={persistenceState.locked} onClick={open}>
					Open…
				</button>
			</div>
		</div>
	);
});
