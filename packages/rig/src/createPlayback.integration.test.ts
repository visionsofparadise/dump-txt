import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayback } from "./createPlayback";
import { DemoStopped } from "./DemoRig";
import type { PlaybackOptions } from "./createPlayback";
import type { ChromeContext } from "@dump-txt/ui";

const context = {} as unknown as ChromeContext;

function stubFonts(owner: Document = document): () => void {
	let release = () => {};
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});

	Object.defineProperty(owner, "fonts", { configurable: true, value: { ready } });

	return release;
}

function createStage(): HTMLElement {
	const stage = document.createElement("div");

	document.body.append(stage);

	return stage;
}

function createOptions(overrides: Partial<PlaybackOptions> = {}): PlaybackOptions {
	return {
		stage: createStage(),
		context: () => context,
		origin: { x: 820, y: 650 },
		script: (rig) => rig.wait(100),
		...overrides,
	};
}

describe("createPlayback", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		Reflect.deleteProperty(document, "fonts");
		document.body.replaceChildren();
	});

	it("appends a hidden pointer to the stage and removes it on dispose", () => {
		stubFonts()();

		const options = createOptions();
		const playback = createPlayback(options);
		const pointer = options.stage.querySelector(".demo-pointer");

		expect(pointer?.getAttribute("aria-hidden")).toBe("true");
		expect(pointer?.querySelector("svg path")).not.toBeNull();

		playback.dispose();

		expect(options.stage.querySelector(".demo-pointer")).toBeNull();
	});

	it("is ready once fonts have loaded and the editor context exists", async () => {
		const releaseFonts = stubFonts();
		let current: ChromeContext | null = context;
		const playback = createPlayback(createOptions({ context: () => current }));

		expect(playback.ready).toBe(false);

		releaseFonts();
		await vi.advanceTimersByTimeAsync(0);

		expect(playback.ready).toBe(true);

		current = null;

		expect(playback.ready).toBe(false);
	});

	it("finishes when the script completes", async () => {
		stubFonts()();

		const playback = createPlayback(createOptions());
		const playing = playback.play();

		expect(playback.finished).toBe(false);

		await vi.advanceTimersByTimeAsync(100);
		await playing;

		expect(playback.finished).toBe(true);
		expect(playback.error).toBeNull();
	});

	it("returns the running promise when played again during a run", async () => {
		stubFonts()();

		const script = vi.fn((rig: Parameters<PlaybackOptions["script"]>[0]) => rig.wait(100));
		const playback = createPlayback(createOptions({ script }));
		const playing = playback.play();

		expect(playback.play()).toBe(playing);

		await vi.advanceTimersByTimeAsync(100);
		await playing;

		expect(script).toHaveBeenCalledOnce();
	});

	it("records the script's error and rejects", async () => {
		stubFonts()();

		const playback = createPlayback(
			createOptions({
				script: () => Promise.reject(new Error("Demo target is missing: .page-tab")),
			}),
		);

		await expect(playback.play()).rejects.toThrow("Demo target is missing: .page-tab");

		expect(playback.error).toBe("Demo target is missing: .page-tab");
		expect(playback.finished).toBe(false);
	});

	it("rejects with DemoStopped when stopped during a run and records no error", async () => {
		stubFonts()();

		const playback = createPlayback(createOptions({ script: (rig) => rig.wait(10_000) }));
		const playing = expect(playback.play()).rejects.toBeInstanceOf(DemoStopped);

		await vi.advanceTimersByTimeAsync(1000);
		playback.stop();

		await playing;

		expect(playback.error).toBeNull();
		expect(playback.finished).toBe(false);
	});

	it("plays across surfaces once fonts load in every surface document", async () => {
		const releasePage = stubFonts();
		const stage = createStage();
		const frame = document.createElement("iframe");
		const tiles = document.createElement("div");

		document.body.append(frame, tiles);

		const frameDocument = frame.contentDocument;

		if (!frameDocument) throw new Error("The frame document is missing.");

		const releaseFrame = stubFonts(frameDocument);
		const close = frameDocument.createElement("button");

		close.setAttribute("aria-label", "Close window");
		vi.spyOn(close, "getBoundingClientRect").mockReturnValue({
			left: 40,
			top: 20,
			width: 40,
			height: 20,
			x: 40,
			y: 20,
			right: 80,
			bottom: 40,
			toJSON: () => ({}),
		});
		frameDocument.body.append(close);

		const script = vi.fn((rig: Parameters<PlaybackOptions["script"]>[0]) => rig.move('[aria-label="Close window"]'));
		const playback = createPlayback(
			createOptions({
				stage,
				surfaces: [
					{ root: frameDocument, pointOf: ({ x, y }) => ({ x: x + 300, y: y + 200 }) },
					{ root: tiles, pointOf: (point) => point },
				],
				script,
			}),
		);
		const playing = playback.play();

		releasePage();
		await vi.advanceTimersByTimeAsync(0);

		expect(playback.ready).toBe(false);
		expect(script).not.toHaveBeenCalled();

		releaseFrame();
		await vi.advanceTimersByTimeAsync(500);
		await playing;

		expect(playback.ready).toBe(true);
		expect(script).toHaveBeenCalledOnce();
		expect(frameDocument.querySelector(".demo-pointer")).toBeNull();
		expect(stage.querySelector<HTMLElement>(".demo-pointer")?.style.transform).toBe("translate(360px, 230px)");
	});
});
