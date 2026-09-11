import { scope } from "opshot";
import { useCallback } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import type { AppContext } from "../../models/AppContext";

interface SaveStatusProps {
	readonly context: AppContext;
}

export const SaveStatus = scope(({ context }: SaveStatusProps) => {
	const { persistence, persistenceState } = context;
	const capabilities = capabilitiesOf(context.main);

	const retry = useCallback(() => {
		void persistence.flush().catch(() => undefined);
	}, [persistence]);

	const saveAs = useCallback(() => {
		if (!capabilities.saveAs) return;

		void persistence.saveAs().catch(() => undefined);
	}, [capabilities.saveAs, persistence]);

	const open = useCallback(() => {
		if (!capabilities.openDump) return;

		void persistence.open().catch(() => undefined);
	}, [capabilities.openDump, persistence]);

	if (!persistenceState.error) return null;

	return (
		<div role="status" aria-live="polite" className="save-error">
			<span>{persistenceState.error}</span>
			<div className="save-error-actions">
				<button className="panel-button" disabled={persistenceState.locked} onClick={retry}>
					Retry
				</button>
				<button className="panel-button" disabled={persistenceState.locked || !capabilities.saveAs} onClick={saveAs}>
					Save As…
				</button>
				<button className="panel-button" disabled={persistenceState.locked || !capabilities.openDump} onClick={open}>
					Open…
				</button>
			</div>
		</div>
	);
});
