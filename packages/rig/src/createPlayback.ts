import { DemoRig, DemoStopped, type DemoSurface } from "./DemoRig";
import type { ChromeContext } from "@dump-txt/ui";

export interface PlaybackOptions {
	readonly stage: HTMLElement;
	readonly context: () => ChromeContext | null;
	readonly origin: { readonly x: number; readonly y: number };
	readonly surfaces?: ReadonlyArray<DemoSurface>;
	readonly script: (rig: DemoRig) => Promise<void>;
}

export interface DemoPlayback {
	readonly ready: boolean;
	readonly finished: boolean;
	readonly error: string | null;
	play(): Promise<void>;

	stop(): void;

	pause(): void;

	resume(): void;

	dispose(): void;
}

const svgNamespace = "http://www.w3.org/2000/svg";

export function createPlayback(options: PlaybackOptions): DemoPlayback {
	const owner = options.stage.ownerDocument;
	const pointer = owner.createElement("div");
	const svg = owner.createElementNS(svgNamespace, "svg");
	const path = owner.createElementNS(svgNamespace, "path");

	pointer.className = "demo-pointer";
	pointer.setAttribute("aria-hidden", "true");
	svg.setAttribute("viewBox", "0 0 24 30");
	svg.setAttribute("width", "24");
	svg.setAttribute("height", "30");
	path.setAttribute("d", "M3 2 L3 24 L9 18 L14 28 L18 26 L13 16 L22 16 Z");
	svg.append(path);
	pointer.append(svg);
	options.stage.append(pointer);

	const rig = new DemoRig({
		stage: options.stage,
		pointer,
		context: options.context,
		origin: options.origin,
		surfaces: options.surfaces,
	});
	const documents = new Set(
		options.surfaces?.map(({ root }) => ("documentElement" in root ? root : root.ownerDocument)) ?? [owner],
	);
	const awaitFonts = () => Promise.all([...documents].map((surfaceDocument) => surfaceDocument.fonts.ready));
	let fontsReady = false;
	let finished = false;
	let error: string | null = null;
	let running: Promise<void> | null = null;

	void awaitFonts().then(() => {
		fontsReady = true;
	});

	const run = async (): Promise<void> => {
		try {
			await awaitFonts();

			while (!options.context()) await rig.wait(50);

			await options.script(rig);
			finished = true;
		} catch (caught: unknown) {
			if (!(caught instanceof DemoStopped)) error = caught instanceof Error ? caught.message : String(caught);

			throw caught;
		}
	};

	return {
		get ready() {
			return fontsReady && options.context() !== null;
		},
		get finished() {
			return finished;
		},
		get error() {
			return error;
		},
		play() {
			if (running) return running;

			finished = false;
			error = null;

			const started = run().finally(() => {
				running = null;
			});

			running = started;

			return started;
		},
		stop() {
			rig.stop();
		},
		pause() {
			rig.pause();
		},
		resume() {
			rig.resume();
		},
		dispose() {
			rig.stop();
			pointer.remove();
		},
	};
}
