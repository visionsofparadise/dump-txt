import { Copy, Minus, Square, X } from "lucide-react";
import { scope } from "opshot";
import { useCallback, useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "../utils/cn";
import type { AppContext } from "../models/AppContext";
import type { ChromeState } from "../models/ChromeState";

interface TitleBarProps {
	readonly children?: ReactNode;
	readonly chrome?: ChromeState;
	readonly onDismissMenu?: () => void;
	readonly context: AppContext;
}

export const TitleBar = scope(({ children, chrome, onDismissMenu, context }: TitleBarProps) => {
	const { main, events, persistence, persistenceState } = context;
	const [maximized, setMaximized] = useState(false);
	const filename = persistenceState.path?.split(/[\\/]/u).at(-1) ?? "dump.txt";
	const menuOpen = chrome?.menuOpen ?? false;
	const dismissMenu = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (
				event.target instanceof Node &&
				event.currentTarget.contains(event.target) &&
				!(event.target instanceof Element && event.target.closest(".title-menu"))
			)
				onDismissMenu?.();
		},
		[onDismissMenu],
	);

	useEffect(() => {
		document.title = filename;
		void main.setTitle(filename).catch((error: unknown) => console.error(error));
	}, [filename, main]);

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
		<header
			className={cn("title-bar", menuOpen && "title-bar-menu-open")}
			data-tauri-drag-region={menuOpen ? undefined : ""}
			aria-label="Window controls"
			onPointerDown={menuOpen ? dismissMenu : undefined}
		>
			<div className="title-menu">{children}</div>
			<span className="app-name" title={filename} data-tauri-drag-region={menuOpen ? undefined : ""}>
				{filename}
			</span>
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
				<button
					className="chrome-button window-close"
					aria-label="Close window"
					title="Close window"
					onClick={close}
				>
					<X size={14} aria-hidden />
				</button>
			</div>
		</header>
	);
});
