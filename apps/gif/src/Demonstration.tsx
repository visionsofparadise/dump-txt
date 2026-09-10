import { DemoRig, MemoryMain } from "@dump-txt/rig";
import { App, type ChromeContext } from "@dump-txt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import icon from "../../desktop/assets/icon.svg";
import { demonstrate } from "./demonstrate";

interface DemoPlayback {
	readonly ready: boolean;
	finished: boolean;
	error: string | null;
	play(): void;
}

declare global {
	interface Window {
		demo: DemoPlayback;
	}
}

export function Demonstration() {
	const stage = useRef<HTMLDivElement>(null);

	const pointer = useRef<HTMLDivElement>(null);

	const context = useRef<ChromeContext>(null);

	const [opened, setOpened] = useState(true);

	const [main] = useState(
		() => new MemoryMain({ onClose: () => setOpened(false), font: "monospace", theme: "light" }),
	);

	const open = useCallback(() => setOpened(true), []);

	useEffect(() => {
		if (!stage.current || !pointer.current) return;

		const rig = new DemoRig({
			origin: { x: 820, y: 650 },
			stage: stage.current,
			pointer: pointer.current,
			context: () => context.current,
		});
		let playing = false;
		let fontsReady = false;

		void document.fonts.ready.then(() => {
			fontsReady = true;
		});

		window.demo = {
			get ready() {
				return fontsReady && context.current !== null;
			},
			finished: false,
			error: null,
			play: () => {
				if (playing || !window.demo.ready) return;

				playing = true;
				void demonstrate(rig)
					.then(() => {
						window.demo.finished = true;
					})
					.catch((error: unknown) => {
						window.demo.error = error instanceof Error ? error.message : String(error);
					});
			},
		};

		if (!new URLSearchParams(window.location.search).has("autoplay")) return;

		const autoplay = window.setInterval(() => {
			if (!window.demo.ready) return;

			window.clearInterval(autoplay);
			window.demo.play();
		}, 50);

		return () => window.clearInterval(autoplay);
	}, []);

	return (
		<div className="demo-desktop" ref={stage}>
			<button className="desktop-icon" type="button" onDoubleClick={open} onClick={open} aria-label="Open dump.txt">
				<img src={icon} alt="" draggable={false} />
				<span>dump.txt</span>
			</button>
			{opened && (
				<div className="demo-window">
					<App main={main} ref={context} />
				</div>
			)}
			<div className="demo-pointer" ref={pointer} aria-hidden="true">
				<svg viewBox="0 0 24 30" width="24" height="30">
					<path d="M3 2 L3 24 L9 18 L14 28 L18 26 L13 16 L22 16 Z" />
				</svg>
			</div>
		</div>
	);
}
