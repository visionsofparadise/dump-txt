import {
	BrowserMain,
	createPlayback,
	demonstrate,
	DemoStopped,
	type BrowserMainOptions,
	type DemoSurface,
} from "@dump-txt/rig";
import { App, type ChromeContext } from "@dump-txt/ui";
import { appStateSchema } from "@dump-txt/ui/host";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { pagePointOf } from "../utils/pagePointOf";
import { platformOf, type Platform } from "../utils/platformOf";
import { windowReportOf, type WindowState } from "../utils/windowMessages";
import { FrameWindow } from "./models/FrameWindow";
import { guardDemonstrationFocus } from "./utils/guardDemonstrationFocus";

const freshOptions = { theme: "light", font: "Consolas" } as const;

const failedLoopDelay = 1000;

interface PageStage {
	readonly stage: HTMLElement;
	readonly origin: { readonly x: number; readonly y: number };
	readonly surfaces: ReadonlyArray<DemoSurface>;
}

type HostOptions = Awaited<ReturnType<typeof carriedOptionsOf>> | typeof freshOptions;

function isPlatform(value: unknown): value is Platform {
	return value === "windows" || value === "macos" || value === "linux";
}

function messagePlatformOf(data: unknown): Platform | null {
	if (typeof data !== "object" || data === null || !("type" in data) || !("platform" in data)) return null;

	return data.type === "platform" && isPlatform(data.platform) ? data.platform : null;
}

function pageStageOf(element: HTMLElement): PageStage | null {
	const frame = element.ownerDocument.defaultView?.frameElement;
	const pageView = frame?.ownerDocument.defaultView;

	if (!frame || !pageView || !(frame instanceof pageView.HTMLElement)) return null;

	const stage = frame.ownerDocument.getElementById("pointer-stage");
	const taskbar = frame.ownerDocument.getElementById("github");

	if (!stage || !taskbar) return null;

	let x = element.clientWidth * 0.85 - stage.offsetLeft;
	let y = element.clientHeight * 0.9 - stage.offsetTop;
	let offsetElement: Element | null = frame;

	while (offsetElement instanceof pageView.HTMLElement && offsetElement !== stage.offsetParent) {
		x += offsetElement.offsetLeft;
		y += offsetElement.offsetTop;
		offsetElement = offsetElement.offsetParent;
	}

	return {
		stage,
		origin: { x, y },
		surfaces: [
			{ root: element, pointOf: (point) => pagePointOf(frame, point) },
			{ root: taskbar, pointOf: (point) => point, isKeyTarget: false },
		],
	};
}

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

export function AppFrame() {
	const stage = useRef<HTMLDivElement>(null);

	const context = useRef<ChromeContext>(null);

	const [isContextMounted, setContextMounted] = useState(false);

	const [frameWindow] = useState(() => new FrameWindow());

	const createMain = (platform: BrowserMainOptions["platform"], options: HostOptions, isDemonstrating: boolean) => {
		const next = new BrowserMain({ platform, ...options, ...frameWindow.hostCallbacksOf(isDemonstrating) });

		next.setMaximized(frameWindow.isMaximized);

		return next;
	};

	const attachContext = useCallback((value: ChromeContext | null) => {
		context.current = value;
		setContextMounted(value !== null);
	}, []);

	const [platform, setPlatform] = useState(() => {
		const requested = new URLSearchParams(window.location.search).get("platform");

		return isPlatform(requested) ? requested : platformOf(navigator);
	});

	const [mode, setMode] = useState<"demonstrating" | "interactive">("demonstrating");

	const [windowState, setWindowState] = useState<WindowState>("open");

	const [main, setMain] = useState(() => createMain(platform, freshOptions, true));

	const [hostGeneration, setHostGeneration] = useState(0);

	useEffect(() => {
		if (isContextMounted) main.emit("maximizedChanged", main.maximized);
	}, [isContextMounted, main]);

	const replaceMain = (next: BrowserMain) => {
		frameWindow.detach();
		setMain(next);
		setHostGeneration((generation) => generation + 1);
	};

	const takeOver = () => {
		frameWindow.stopHolding();
		replaceMain(createMain(platform, freshOptions, false));
		setMode("interactive");
	};

	const receiveReport = useEffectEvent((event: MessageEvent<unknown>) => {
		const report = event.origin === window.location.origin ? windowReportOf(event.data) : null;

		if (!report) return;

		main.setMaximized(report.isMaximized);
		setWindowState(report.state);
		frameWindow.receiveReport(report, mode === "demonstrating", () => context.current !== null);
	});

	const receiveClick = useEffectEvent((event: MouseEvent) => {
		const element = stage.current;

		frameWindow.recordClick(event);

		if (mode === "demonstrating" && element && event.target instanceof Node && !element.contains(event.target))
			takeOver();
	});

	useEffect(() => {
		const receive = (event: MessageEvent<unknown>) => {
			const next = messagePlatformOf(event.data);

			if (event.origin === window.location.origin && next) setPlatform(next);
			else receiveReport(event);
		};

		window.addEventListener("message", receive);

		return () => {
			window.removeEventListener("message", receive);
		};
	}, []);

	useEffect(() => {
		const receive = (event: MouseEvent) => {
			receiveClick(event);
		};

		window.addEventListener("click", receive, true);

		return () => {
			window.removeEventListener("click", receive, true);
		};
	}, []);

	useEffect(() => {
		const element = stage.current;

		if (mode !== "demonstrating" || !element) return;

		return guardDemonstrationFocus(element);
	}, [mode]);

	useEffect(() => {
		const element = stage.current;
		const view = element?.ownerDocument.defaultView;

		if (mode !== "demonstrating" || !element || !view) return;

		const page = view.frameElement?.ownerDocument.defaultView;
		const windows = page ? [view, page] : [view];

		let release: ReturnType<typeof setTimeout> | undefined;

		const passStage = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;

			if (event.target instanceof Node && element.contains(event.target)) event.stopPropagation();

			element.inert = true;
			clearTimeout(release);
			release = setTimeout(() => {
				element.inert = false;
			});
		};

		for (const target of windows) target.addEventListener("keydown", passStage, true);

		return () => {
			for (const target of windows) target.removeEventListener("keydown", passStage, true);

			clearTimeout(release);
			element.inert = false;
		};
	}, [mode]);

	useEffect(() => {
		const element = stage.current;

		if (mode !== "demonstrating" || !element) return;

		const page = pageStageOf(element);
		const current = createPlayback({
			stage: page?.stage ?? element,
			surfaces: page?.surfaces,
			context: () => context.current,
			origin: page?.origin ?? { x: element.clientWidth * 0.85, y: element.clientHeight * 0.9 },
			script: async (rig) => {
				try {
					await demonstrate(rig, { reopen: page !== null });
				} catch (error: unknown) {
					if (error instanceof DemoStopped) throw error;

					console.error(error);
					await rig.wait(failedLoopDelay);
				}
			},
		});

		frameWindow.attach(current);

		let restart: ReturnType<typeof setTimeout> | undefined;

		const replay = (delay: number) => {
			if (!frameWindow.isPlaying(current)) return;

			restart = setTimeout(() => {
				if (frameWindow.isPlaying(current))
					frameWindow.restart(() => {
						replaceMain(createMain(main.platform, freshOptions, true));
					});
			}, delay);
		};

		current.play().then(
			() => {
				replay(0);
			},
			(error: unknown) => {
				if (error instanceof DemoStopped) return;

				console.error(error);
				replay(failedLoopDelay);
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

				if (!transfer.signal.aborted) replaceMain(createMain(platform, options, mode === "demonstrating"));
			} catch (error: unknown) {
				console.error(error);
			}
		})();

		return () => {
			transfer.abort();
		};
	}, [platform, main, mode]);

	return (
		<>
			<div
				ref={stage}
				className={mode === "demonstrating" ? "appbox-stage demo-stage" : "appbox-stage"}
				data-window={windowState}
			>
				{(mode === "demonstrating" || windowState !== "closed") && (
					<App key={hostGeneration} main={main} ref={attachContext} />
				)}
			</div>
			{mode === "demonstrating" && <button className="appbox-takeover" type="button" aria-label="Try dump.txt" />}
		</>
	);
}
