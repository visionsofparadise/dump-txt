import { scope } from "opshot";
import { useCallback } from "react";
import { capabilitiesOf } from "../../models/MainCapabilities";
import { Alert } from "../UI/Alert";
import { Button } from "../UI/Button";
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
		<Alert className="absolute right-2.5 bottom-2 left-2.5 z-7 max-h-[calc(100%-16px)]">
			<span>{persistenceState.error}</span>
			<div className="save-error-actions">
				<Button variant="panel" disabled={persistenceState.locked} onClick={retry}>
					Retry
				</Button>
				<Button variant="panel" disabled={persistenceState.locked || !capabilities.saveAs} onClick={saveAs}>
					Save As…
				</Button>
				<Button variant="panel" disabled={persistenceState.locked || !capabilities.openDump} onClick={open}>
					Open…
				</Button>
			</div>
		</Alert>
	);
});
