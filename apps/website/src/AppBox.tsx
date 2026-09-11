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

	const box = useRef<HTMLDivElement>(null);

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

		const owner = element.ownerDocument;
		const focus = HTMLElement.prototype.focus;
		const select = HTMLInputElement.prototype.select;

		const isHeldElsewhere = (target: Element) => {
			const active = owner.activeElement;

			return (
				element.contains(target) &&
				active !== null &&
				active !== owner.body &&
				active !== owner.documentElement &&
				!element.contains(active)
			);
		};

		HTMLElement.prototype.focus = function focusUnlessHeldElsewhere(options?: FocusOptions) {
			if (!isHeldElsewhere(this)) focus.call(this, options);
		};

		HTMLInputElement.prototype.select = function selectUnlessHeldElsewhere() {
			if (!isHeldElsewhere(this)) select.call(this);
		};

		return () => {
			HTMLElement.prototype.focus = focus;
			HTMLInputElement.prototype.select = select;
		};
	}, [mode]);

	useEffect(() => {
		const element = stage.current;
		const contents = box.current;
		const view = element?.ownerDocument.defaultView;

		if (mode !== "demonstrating" || !element || !contents || !view) return;

		let release: ReturnType<typeof setTimeout> | undefined;

		const passBox = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;

			if (event.target instanceof Node && element.contains(event.target)) event.stopPropagation();

			contents.inert = true;
			clearTimeout(release);
			release = setTimeout(() => {
				contents.inert = false;
			});
		};

		view.addEventListener("keydown", passBox, true);

		return () => {
			view.removeEventListener("keydown", passBox, true);
			clearTimeout(release);
			contents.inert = false;
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
		<div id="app">
			<div ref={stage} className={mode === "demonstrating" ? "appbox-stage demo-stage" : "appbox-stage"}>
				<div id="appbox" ref={box}>
					<App key={hostGeneration} main={main} ref={context} />
				</div>
			</div>
			{mode === "demonstrating" && (
				<button className="appbox-takeover" type="button" aria-label="Try dump.txt" onClick={takeOver} />
			)}
		</div>
	);
}
