import { BrowserMain, createPlayback, demonstrate, DemoStopped, type DemoPlayback } from "@dump-txt/rig";
import { App, type ChromeContext } from "@dump-txt/ui";
import { appStateSchema } from "@dump-txt/ui/host";
import { useEffect, useRef, useState } from "react";
import { platformOf, type Platform } from "../utils/platformOf";

const freshOptions = { theme: "light", font: "Consolas" } as const;

function isPlatform(value: unknown): value is Platform {
	return value === "windows" || value === "macos" || value === "linux";
}

function messagePlatformOf(data: unknown): Platform | null {
	if (typeof data !== "object" || data === null || !("type" in data) || !("platform" in data)) return null;

	return data.type === "platform" && isPlatform(data.platform) ? data.platform : null;
}

function isFocusOutside(owner: Document, region: Element): boolean {
	const active = owner.activeElement;

	return active !== null && active !== owner.body && active !== owner.documentElement && !region.contains(active);
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

	const playback = useRef<DemoPlayback>(null);

	const [platform, setPlatform] = useState(() => {
		const requested = new URLSearchParams(window.location.search).get("platform");

		return isPlatform(requested) ? requested : platformOf(navigator);
	});

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
		const receive = (event: MessageEvent<unknown>) => {
			const next = messagePlatformOf(event.data);

			if (event.origin === window.location.origin && next) setPlatform(next);
		};

		window.addEventListener("message", receive);

		return () => {
			window.removeEventListener("message", receive);
		};
	}, []);

	useEffect(() => {
		const element = stage.current;
		const view = element?.ownerDocument.defaultView;

		if (mode !== "demonstrating" || !element || !view) return;

		const frame = view.frameElement;
		const focus = view.HTMLElement.prototype.focus;
		const select = view.HTMLInputElement.prototype.select;

		const isHeldElsewhere = (target: Element) =>
			element.contains(target) &&
			(isFocusOutside(element.ownerDocument, element) || (frame !== null && isFocusOutside(frame.ownerDocument, frame)));

		view.HTMLElement.prototype.focus = function focusUnlessHeldElsewhere(options?: FocusOptions) {
			if (!isHeldElsewhere(this)) focus.call(this, options);
		};

		view.HTMLInputElement.prototype.select = function selectUnlessHeldElsewhere() {
			if (!isHeldElsewhere(this)) select.call(this);
		};

		return () => {
			view.HTMLElement.prototype.focus = focus;
			view.HTMLInputElement.prototype.select = select;
		};
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
		<>
			<div ref={stage} className={mode === "demonstrating" ? "appbox-stage demo-stage" : "appbox-stage"}>
				<App key={hostGeneration} main={main} ref={context} />
			</div>
			{mode === "demonstrating" && (
				<button className="appbox-takeover" type="button" aria-label="Try dump.txt" onClick={takeOver} />
			)}
		</>
	);
}
