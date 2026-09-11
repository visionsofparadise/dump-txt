import { Copy, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { capabilitiesOf } from "../models/MainCapabilities";
import type { AppContext } from "../models/AppContext";

interface WindowControlsProps {
	readonly context: AppContext;
}

export function WindowControls({ context }: WindowControlsProps) {
	const { main, events, persistence } = context;
	const capabilities = capabilitiesOf(main);

	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		events.on("maximizedChanged", setMaximized);

		return () => {
			events.off("maximizedChanged", setMaximized);
		};
	}, [events]);

	const minimize = useCallback(() => {
		if (!capabilities.minimize) return;

		void main.minimize();
	}, [capabilities.minimize, main]);

	const toggleMaximize = useCallback(() => {
		if (!capabilities.maximize) return;

		void main.toggleMaximize();
	}, [capabilities.maximize, main]);

	const close = useCallback(() => {
		if (!capabilities.close) return;

		void persistence.close().catch(() => undefined);
	}, [capabilities.close, persistence]);

	return (
		<div className="window-controls">
			<button
				className="chrome-button"
				aria-label="Minimize"
				title="Minimize"
				onClick={minimize}
				disabled={!capabilities.minimize}
			>
				<Minus size={14} aria-hidden />
			</button>
			<button
				className="chrome-button"
				aria-label={maximized ? "Restore window" : "Maximize"}
				title={maximized ? "Restore window" : "Maximize"}
				onClick={toggleMaximize}
				disabled={!capabilities.maximize}
			>
				{maximized ? <Copy size={13} aria-hidden /> : <Square size={13} aria-hidden />}
			</button>
			<button
				className="chrome-button window-close"
				aria-label="Close window"
				title="Close window"
				onClick={close}
				disabled={!capabilities.close}
			>
				<X size={14} aria-hidden />
			</button>
		</div>
	);
}
