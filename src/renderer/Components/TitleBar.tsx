import { Copy, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AppContext } from "../models/AppContext";

interface TitleBarProps {
	readonly children?: ReactNode;
	readonly context: AppContext;
}

export function TitleBar({ children, context }: TitleBarProps) {
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
		<header className="title-bar" aria-label="Window controls">
			<div className="title-menu">{children}</div>
			<span className="app-name">dump.txt</span>
			<div className="window-controls">
				<button className="chrome-button" aria-label="Minimize" title="Minimize" onClick={minimize}>
					<Minus size={12} aria-hidden />
				</button>
				<button
					className="chrome-button"
					aria-label={maximized ? "Restore window" : "Maximize"}
					title={maximized ? "Restore window" : "Maximize"}
					onClick={toggleMaximize}
				>
					{maximized ? <Copy size={11} aria-hidden /> : <Square size={11} aria-hidden />}
				</button>
				<button
					className="chrome-button window-close"
					aria-label="Close window"
					title="Close window (Ctrl+W)"
					onClick={close}
				>
					<X size={12} aria-hidden />
				</button>
			</div>
		</header>
	);
}
