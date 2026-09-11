import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBox } from "../AppBox";
import { TaskbarTile } from "../TaskbarTile";
import { isVisitorEvent } from "../utils/isVisitorEvent";
import { playGenie } from "../utils/playGenie";
import { snapshotOf } from "../utils/snapshotOf";
import { useAppWindow } from "./useAppWindow";
import type { Platform } from "../utils/platformOf";
import type { WindowRequest } from "../utils/windowMessages";

vi.mock("../utils/gpuCompositingOf", () => ({ gpuCompositingOf: () => false }));
vi.mock("../utils/isVisitorEvent", () => ({ isVisitorEvent: vi.fn() }));
vi.mock("../utils/snapshotOf", () => ({ snapshotOf: vi.fn() }));
vi.mock("../utils/playGenie", () => ({ playGenie: vi.fn() }));

interface HarnessProps {
	readonly platform: Platform;
}

const noEntrance = {};

const unmounts: Array<() => void> = [];

let isReducedMotion = false;

function ignoreReady(): void {}

function Harness({ platform }: HarnessProps) {
	const control = useAppWindow(platform);

	return (
		<>
			<TaskbarTile control={control} />
			<AppBox
				platform={platform}
				entrance={noEntrance}
				tiltTransition={null}
				control={control}
				onApplicationReady={ignoreReady}
			/>
		</>
	);
}

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
	const deadline = Date.now() + 5000;

	for (;;) {
		const value = read();

		if (value) return value;

		if (Date.now() > deadline) throw new Error("The condition was never met.");

		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 10);
			});
		});
	}
}

async function mount(platform: Platform = "windows") {
	const container = document.createElement("main");
	const root = createRoot(container);

	container.id = "hero";
	document.body.append(container);
	await act(async () => {
		root.render(<Harness platform={platform} />);
	});
	unmounts.push(() => {
		root.unmount();
	});

	const frame = container.querySelector("iframe");

	if (!frame?.contentWindow) throw new Error("The application frame is not mounted.");

	const posted = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => undefined);
	const elementOf = (selector: string) => {
		const element = container.querySelector<HTMLElement>(selector);

		if (!element) throw new Error(`The ${selector} element is not mounted.`);

		return element;
	};
	const label = () => elementOf("#tile").getAttribute("aria-label");
	const windowState = () => elementOf("#app").dataset.window;
	const animation = () => elementOf("#appanim").dataset.animation;
	const pressTile = async (isVisitor = true) => {
		vi.mocked(isVisitorEvent).mockReturnValue(isVisitor);
		await act(async () => {
			elementOf("#tile").click();
		});
	};
	const finishAnimation = async () => {
		await act(async () => {
			elementOf("#appanim").dispatchEvent(new Event("animationend", { bubbles: true }));
		});
	};
	const request = async (data: WindowRequest) => {
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin }));
		});
	};
	const wasReported = (state: string, isMaximized = false) =>
		posted.mock.calls.some(
			([data, origin]) =>
				JSON.stringify(data) === JSON.stringify({ type: "window", state, isMaximized }) &&
				origin === window.location.origin,
		);

	return { container, label, windowState, animation, pressTile, finishAnimation, request, wasReported, elementOf };
}

beforeEach(() => {
	isReducedMotion = false;
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({ matches: isReducedMotion && query.includes("reduced-motion") })),
	);
	vi.mocked(isVisitorEvent).mockReturnValue(true);
	vi.mocked(snapshotOf).mockResolvedValue(document.createElement("canvas"));
	vi.mocked(playGenie).mockResolvedValue(undefined);
});

afterEach(async () => {
	for (const unmount of unmounts.splice(0)) await act(unmount);

	document.body.replaceChildren();
	vi.mocked(snapshotOf).mockReset();
	vi.mocked(playGenie).mockReset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("useAppWindow", () => {
	it("labels the tile by the window state as the visitor minimizes and restores through it", async () => {
		const { label, windowState, animation, pressTile, finishAnimation, wasReported, elementOf } = await mount();

		expect(label()).toBe("Minimize dump.txt");
		expect(elementOf("#tile").title).toBe("Minimize dump.txt");

		await pressTile();
		await until(() => animation() === "win-min");

		expect(label()).toBe("Restore dump.txt");
		expect(windowState()).toBe("minimized");
		expect(wasReported("minimized")).toBe(true);

		await finishAnimation();
		await pressTile();
		await until(() => animation() === "win-restore");

		expect(label()).toBe("Minimize dump.txt");
		expect(wasReported("open")).toBe(true);

		await finishAnimation();
		await until(() => animation() === undefined);
	});

	it("closes on the frame's request, reports the closed window once its animation ends, and opens from the tile", async () => {
		const { label, windowState, animation, pressTile, finishAnimation, request, wasReported } = await mount("linux");

		await request({ type: "close", isDemonstration: false });
		await until(() => animation() === "gnome-close");

		expect(windowState()).toBe("closed");
		expect(label()).toBe("Open dump.txt");
		expect(wasReported("closed")).toBe(false);

		await finishAnimation();
		await until(() => wasReported("closed"));
		await pressTile();
		await until(() => animation() === "gnome-open");

		expect(windowState()).toBe("open");
		expect(wasReported("open")).toBe(true);
	});

	it("ignores a visitor's tile click while the demonstration's own close holds the window and opens on its click", async () => {
		const { windowState, pressTile, finishAnimation, request, wasReported } = await mount();

		await request({ type: "close", isDemonstration: true });
		await finishAnimation();
		await until(() => wasReported("closed"));
		await pressTile(true);
		await until(() => vi.mocked(isVisitorEvent).mock.calls.length > 0);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
		});

		expect(windowState()).toBe("closed");

		await pressTile(false);
		await until(() => windowState() === "open");
	});

	it("opens a closed window on the frame's open request", async () => {
		const { windowState, finishAnimation, request } = await mount();

		await request({ type: "close", isDemonstration: true });
		await finishAnimation();
		await request({ type: "open" });
		await until(() => windowState() === "open");
	});

	it("toggles maximize on the frame's request and reports each change", async () => {
		const { elementOf, request, wasReported } = await mount();

		await request({ type: "toggleMaximize" });
		await until(() => elementOf("#app").dataset.maximized === "true");

		expect(wasReported("open", true)).toBe(true);

		await request({ type: "toggleMaximize" });
		await until(() => elementOf("#app").dataset.maximized === "false");
	});

	it("hides the macOS window behind a genie drawn from its snapshot and warps it back on restore", async () => {
		const { windowState, animation, pressTile } = await mount("macos");

		await pressTile();
		await until(() => vi.mocked(playGenie).mock.calls.length === 1);

		expect(playGenie).toHaveBeenLastCalledWith(expect.objectContaining({ isReverse: false, radius: 8 }));
		expect(animation()).toBe("mac-hold");
		expect(windowState()).toBe("minimized");

		await pressTile();
		await until(() => vi.mocked(playGenie).mock.calls.length === 2);
		await until(() => animation() === undefined);

		expect(playGenie).toHaveBeenLastCalledWith(expect.objectContaining({ isReverse: true }));
		expect(windowState()).toBe("open");
	});

	it("runs the macOS minimize keyframes when the snapshot fails", async () => {
		vi.mocked(snapshotOf).mockResolvedValue(null);

		const { animation, pressTile } = await mount("macos");

		await pressTile();
		await until(() => animation() === "mac-min");

		expect(playGenie).not.toHaveBeenCalled();
	});

	it("runs the macOS minimize keyframes without a snapshot under reduced motion", async () => {
		isReducedMotion = true;

		const { animation, pressTile } = await mount("macos");

		await pressTile();
		await until(() => animation() === "mac-min");

		expect(snapshotOf).not.toHaveBeenCalled();
	});
});
