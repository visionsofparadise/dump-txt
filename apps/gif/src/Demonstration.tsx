import { createPlayback, demonstrate, MemoryMain, type DemoPlayback } from "@dump-txt/rig";
import { App, type ChromeContext } from "@dump-txt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import icon from "../../desktop/assets/icon.svg";

declare global {
	interface Window {
		demo: DemoPlayback;
	}
}

export function Demonstration() {
	const stage = useRef<HTMLDivElement>(null);

	const context = useRef<ChromeContext>(null);

	const [opened, setOpened] = useState(true);

	const [main] = useState(
		() => new MemoryMain({ onClose: () => setOpened(false), font: "monospace", theme: "light" }),
	);

	const open = useCallback(() => setOpened(true), []);

	useEffect(() => {
		if (!stage.current) return;

		const playback = createPlayback({
			stage: stage.current,
			context: () => context.current,
			origin: { x: 820, y: 650 },
			script: (rig) => demonstrate(rig, { reopen: true }),
		});

		window.demo = playback;

		if (!new URLSearchParams(window.location.search).has("autoplay")) return () => playback.dispose();

		const autoplay = window.setInterval(() => {
			if (!window.demo.ready) return;

			window.clearInterval(autoplay);
			void window.demo.play().catch(() => undefined);
		}, 50);

		return () => {
			window.clearInterval(autoplay);
			playback.dispose();
		};
	}, []);

	return (
		<div className="demo-desktop demo-stage" ref={stage}>
			<button className="desktop-icon" type="button" onDoubleClick={open} onClick={open} aria-label="Open dump.txt">
				<img src={icon} alt="" draggable={false} />
				<span>dump.txt</span>
			</button>
			{opened && (
				<div className="demo-window">
					<App main={main} ref={context} />
				</div>
			)}
		</div>
	);
}
