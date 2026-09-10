import { Copy, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppContext } from "../models/AppContext";

interface WindowControlsProps {
	readonly context: AppContext;
}

export function WindowControls({ context }: WindowControlsProps) {
	const { main, events, persistence } = context;

	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		events.on("maximizedChanged", setMaximized);

		return () => {
			events.off("maximizedChanged", setMaximized);
		};
	}, [events]);

	const minimize = useCallback(() => {
		void main.minimize();
	}, [main]);

	const toggleMaximize = useCallback(() => {
		void main.toggleMaximize();
	}, [main]);

	const close = useCallback(() => {
		void persistence.close().catch(() => undefined);
	}, [persistence]);

	return (
		<div className="window-controls">
			<button className="chrome-button" aria-label="Minimize" title="Minimize" onClick={minimize}>
				<Minus size={14} aria-hidden />
			</button>
			<button
				className="chrome-button"
				aria-label={maximized ? "Restore window" : "Maximize"}
				title={maximized ? "Restore window" : "Maximize"}
				onClick={toggleMaximize}
			>
				{maximized ? <Copy size={13} aria-hidden /> : <Square size={13} aria-hidden />}
			</button>
			<button className="chrome-button window-close" aria-label="Close window" title="Close window" onClick={close}>
				<X size={14} aria-hidden />
			</button>
		</div>
	);
}
