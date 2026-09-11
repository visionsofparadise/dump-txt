import { BrowserMain, createPlayback, demonstrate, DemoStopped, type DemoPlayback } from "@dump-txt/rig";
import { App, type ChromeContext } from "@dump-txt/ui";
import { appStateSchema } from "@dump-txt/ui/host";
import { useEffect, useRef, useState } from "react";
import type { Platform } from "./utils/platformOf";

interface AppBoxProps {
	readonly platform: Platform;
}

const freshOptions = { theme: "light", font: "Consolas" } as const;

async function carriedOptionsOf(main: BrowserMain, context: ChromeContext | null) {
	await context?.persistence.flush();

	const { startupSettings } = await main.getPaths();

	if (!startupSettings) throw new Error("The dump settings are missing.");

	const decoder = new TextDecoder();
	const state = appStateSchema.parse(JSON.parse(decoder.decode(startupSettings.bytes)));
	const file = await main.readFile(state.activePath);

	return {
		text: decoder.decode(file?.bytes),
		theme: state.appearance.theme,
		font: state.appearance.font,
		textSize: state.appearance.textSize,
		showStatusBar: state.appearance.showStatusBar,
	};
}

export function AppBox({ platform }: AppBoxProps) {
	const stage = useRef<HTMLDivElement>(null);

	const context = useRef<ChromeContext>(null);

	const playback = useRef<DemoPlayback>(null);

	const [mode, setMode] = useState<"demonstrating" | "interactive">("demonstrating");

	const [main, setMain] = useState(() => new BrowserMain({ platform, ...freshOptions }));

	const [hostGeneration, setHostGeneration] = useState(0);

	const replaceMain = (next: BrowserMain) => {
		playback.current?.dispose();
		playback.current = null;
		setMain(next);
		setHostGeneration((generation) => generation + 1);
	};

	const takeOver = () => {
		replaceMain(new BrowserMain({ platform, ...freshOptions }));
		setMode("interactive");
	};

	useEffect(() => {
		const element = stage.current;

		if (mode !== "demonstrating" || !element) return;

		const current = createPlayback({
			stage: element,
			context: () => context.current,
			origin: { x: element.clientWidth * 0.85, y: element.clientHeight * 0.9 },
			script: (rig) => demonstrate(rig, { reopen: false }),
		});

		playback.current = current;

		let restart: ReturnType<typeof setTimeout> | undefined;

		const replay = (delay: number) => {
			if (playback.current !== current) return;

			restart = setTimeout(() => {
				if (playback.current === current)
					replaceMain(new BrowserMain({ platform: main.platform, ...freshOptions }));
			}, delay);
		};

		current.play().then(
			() => {
				replay(0);
			},
			(error: unknown) => {
				if (error instanceof DemoStopped) return;

				console.error(error);
				replay(1000);
			},
		);

		return () => {
			clearTimeout(restart);
			current.dispose();
		};
	}, [mode, hostGeneration]);

	useEffect(() => {
		if (main.platform === platform) return;

		const transfer = new AbortController();

		void (async () => {
			try {
				const options = mode === "interactive" ? await carriedOptionsOf(main, context.current) : freshOptions;

				if (!transfer.signal.aborted) replaceMain(new BrowserMain({ platform, ...options }));
			} catch (error: unknown) {
				console.error(error);
			}
		})();

		return () => {
			transfer.abort();
		};
	}, [platform, main, mode]);

	return (
		<div id="app" ref={stage} className={mode === "demonstrating" ? "demo-stage" : undefined}>
			<div id="appbox">
				<App key={hostGeneration} main={main} ref={context} />
			</div>
			{mode === "demonstrating" && (
				<button className="appbox-takeover" type="button" aria-label="Try dump.txt" onClick={takeOver} />
			)}
		</div>
	);
}
