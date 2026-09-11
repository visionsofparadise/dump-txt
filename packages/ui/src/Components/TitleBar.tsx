import { scope } from "opshot";
import { useCallback, useEffect, type PointerEvent, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { HeaderBarControls } from "./HeaderBarControls";
import { TrafficLights } from "./TrafficLights";
import { WindowControls } from "./WindowControls";
import type { AppContext } from "../models/AppContext";
import type { ChromeState } from "../models/ChromeState";

interface TitleBarProps {
	readonly children?: ReactNode;
	readonly chrome?: ChromeState;
	readonly onDismissMenu?: () => void;
	readonly context: AppContext;
}

export const TitleBar = scope(({ children, chrome, onDismissMenu, context }: TitleBarProps) => {
	const { main, persistenceState } = context;
	const platform = main.platform ?? "windows";
	const decorations = main.decorations ?? "native";
	const filename = persistenceState.path?.split(/[\\/]/u).at(-1) ?? "dump.txt";
	const menuOpen = chrome?.menuOpen ?? false;

	const dismissMenu = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (
				event.target instanceof Node &&
				event.currentTarget.contains(event.target) &&
				!(event.target instanceof Element && event.target.closest(".title-menu"))
			) {
				event.preventDefault();
				onDismissMenu?.();
			}
		},
		[onDismissMenu],
	);

	useEffect(() => {
		void main.setTitle(filename).catch((error: unknown) => console.error(error));
	}, [filename, main]);

	return platform === "linux" && decorations === "native" ? null : (
		<header
			className={cn("title-bar", menuOpen && "title-bar-menu-open")}
			data-platform={platform}
			data-tauri-drag-region={menuOpen ? undefined : ""}
			aria-label="Window controls"
			onPointerDown={menuOpen ? dismissMenu : undefined}
		>
			{platform === "macos" && decorations === "drawn" && <TrafficLights context={context} />}
			<div className="title-menu">{children}</div>
			<span className="app-name" title={filename} data-tauri-drag-region={menuOpen ? undefined : ""}>
				{filename}
			</span>
			{platform === "windows" && <WindowControls context={context} />}
			{platform === "linux" && <HeaderBarControls context={context} />}
		</header>
	);
});
