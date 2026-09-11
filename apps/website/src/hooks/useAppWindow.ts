import { useMutableState } from "opshot";
import { useEffect, useMemo, useState, type AnimationEvent, type MouseEvent, type RefObject } from "react";
import { AppWindowController } from "../models/AppWindowController";
import { isVisitorEvent } from "../utils/isVisitorEvent";
import { windowRequestOf } from "../utils/windowMessages";
import type { AppWindow } from "../models/AppWindow";
import type { Platform } from "../utils/platformOf";

export interface AppWindowControl {
	readonly appWindow: AppWindow;
	readonly frame: RefObject<HTMLIFrameElement | null>;
	readonly tile: RefObject<HTMLButtonElement | null>;
	readonly pressTile: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly finishAnimation: (event: AnimationEvent<HTMLDivElement>) => void;
	readonly reportWindow: () => void;
}

export function useAppWindow(platform: Platform): AppWindowControl {
	const appWindow = useMutableState<AppWindow>(() => ({
		state: "open",
		isMaximized: false,
		animation: null,
		tileOffset: { x: 0, y: 0 },
		pose: null,
	}));

	const [controller] = useState(() => new AppWindowController(appWindow));

	useEffect(() => {
		const receive = (event: MessageEvent<unknown>) => {
			const request = event.origin === window.location.origin ? windowRequestOf(event.data) : null;

			if (request) controller.receiveRequest(request, platform);
		};

		window.addEventListener("message", receive);

		return () => {
			window.removeEventListener("message", receive);
		};
	}, [controller, platform]);

	return useMemo(
		() => ({
			appWindow,
			frame: controller.frame,
			tile: controller.tile,
			pressTile: (event: MouseEvent<HTMLButtonElement>) => {
				controller.pressTile(isVisitorEvent(event.nativeEvent), platform);
			},
			finishAnimation: (event: AnimationEvent<HTMLDivElement>) => {
				if (event.target === event.currentTarget) controller.finishAnimation();
			},
			reportWindow: () => {
				controller.reportWindow();
			},
		}),
		[appWindow, controller, platform],
	);
}
