import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FrameWindow } from "./FrameWindow";
import type { WindowReport } from "../../utils/windowMessages";
import type { DemoPlayback } from "@dump-txt/rig";

interface StubPlayback extends DemoPlayback {
	readonly pause: Mock<() => void>;
	readonly resume: Mock<() => void>;
	readonly dispose: Mock<() => void>;
}

const open: WindowReport = { type: "window", state: "open", isMaximized: false };

const minimized: WindowReport = { type: "window", state: "minimized", isMaximized: false };

const closed: WindowReport = { type: "window", state: "closed", isMaximized: false };

let frames: Array<FrameRequestCallback> = [];

let posted: Mock<(message: unknown, origin: string) => void>;

function stubPlayback(): StubPlayback {
	return {
		ready: true,
		finished: false,
		error: null,
		play: () => Promise.resolve(),
		stop: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		dispose: vi.fn(),
	};
}

function runFrames(): void {
	for (const frame of frames.splice(0)) frame(performance.now());
}

beforeEach(() => {
	frames = [];
	posted = vi.fn();
	vi.spyOn(window, "postMessage").mockImplementation((message: unknown, origin?: unknown) => {
		posted(message, String(origin));
	});
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("FrameWindow", () => {
	it("pauses for a visitor's minimize and resumes once the page reports the window open with the application mounted", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();
		let isMounted = false;

		frameWindow.attach(playback);
		frameWindow.hostCallbacksOf(true).onMinimize?.();

		expect(playback.pause).toHaveBeenCalledOnce();
		expect(posted).toHaveBeenCalledExactlyOnceWith({ type: "minimize" }, window.location.origin);

		frameWindow.receiveReport(minimized, true, () => isMounted);
		frameWindow.receiveReport(open, true, () => isMounted);
		runFrames();

		expect(playback.resume).not.toHaveBeenCalled();

		isMounted = true;
		runFrames();

		expect(playback.resume).toHaveBeenCalledOnce();
	});

	it("pauses for a visitor's close and for a minimize the page reports from the tile", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();

		frameWindow.attach(playback);
		frameWindow.recordClick({ isTrusted: true });
		frameWindow.hostCallbacksOf(true).onClose?.();

		expect(playback.pause).toHaveBeenCalledOnce();
		expect(posted).toHaveBeenCalledExactlyOnceWith({ type: "close", isDemonstration: false }, window.location.origin);

		frameWindow.receiveReport(open, true, () => true);
		frameWindow.receiveReport(minimized, true, () => true);

		expect(playback.pause).toHaveBeenCalledTimes(2);

		frameWindow.detach();

		expect(posted).toHaveBeenCalledOnce();
	});

	it("keeps playing through the demonstration's own close and asks the page to open when its host is replaced", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();

		frameWindow.attach(playback);
		frameWindow.recordClick({ isTrusted: false });
		frameWindow.hostCallbacksOf(true).onClose?.();
		frameWindow.receiveReport(closed, true, () => false);

		expect(posted).toHaveBeenCalledExactlyOnceWith({ type: "close", isDemonstration: true }, window.location.origin);
		expect(playback.pause).not.toHaveBeenCalled();

		frameWindow.detach();

		expect(playback.dispose).toHaveBeenCalledOnce();
		expect(posted).toHaveBeenLastCalledWith({ type: "open" }, window.location.origin);
	});

	it("marks a playback remounted once a visitor's close unmounts its application and forgets it when the host is replaced", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();
		const next = stubPlayback();

		frameWindow.attach(playback);
		frameWindow.hostCallbacksOf(true).onMinimize?.();
		frameWindow.receiveReport(minimized, true, () => true);
		frameWindow.receiveReport(open, true, () => true);

		expect(frameWindow.isRemounted(playback)).toBe(false);

		frameWindow.recordClick({ isTrusted: false });
		frameWindow.hostCallbacksOf(true).onClose?.();
		frameWindow.receiveReport(closed, true, () => false);
		frameWindow.receiveReport(open, true, () => true);

		expect(frameWindow.isRemounted(playback)).toBe(false);

		frameWindow.recordClick({ isTrusted: true });
		frameWindow.hostCallbacksOf(true).onClose?.();

		expect(frameWindow.isRemounted(playback)).toBe(false);

		frameWindow.receiveReport(closed, true, () => false);
		frameWindow.receiveReport(open, true, () => true);
		runFrames();

		expect(frameWindow.isRemounted(playback)).toBe(true);
		expect(playback.resume).toHaveBeenCalledTimes(2);

		frameWindow.detach();
		frameWindow.attach(next);

		expect(frameWindow.isRemounted(playback)).toBe(false);
		expect(frameWindow.isRemounted(next)).toBe(false);
	});

	it("keeps playing through a visitor's maximize and remembers the reported maximized window", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();

		frameWindow.attach(playback);
		frameWindow.hostCallbacksOf(true).onToggleMaximize?.();

		expect(frameWindow.isMaximized).toBe(false);

		frameWindow.receiveReport({ ...open, isMaximized: true }, true, () => true);

		expect(posted).toHaveBeenCalledExactlyOnceWith({ type: "toggleMaximize" }, window.location.origin);
		expect(playback.pause).not.toHaveBeenCalled();
		expect(frameWindow.isMaximized).toBe(true);
	});

	it("holds a loop restart while paused, performs it on release, and pauses a playback attached meanwhile", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();
		const next = stubPlayback();
		const replace = vi.fn();

		frameWindow.attach(playback);
		frameWindow.hostCallbacksOf(true).onMinimize?.();
		frameWindow.restart(replace);

		expect(replace).not.toHaveBeenCalled();

		frameWindow.receiveReport(open, true, () => true);

		expect(replace).toHaveBeenCalledOnce();
		expect(playback.resume).not.toHaveBeenCalled();

		frameWindow.restart(replace);

		expect(replace).toHaveBeenCalledTimes(2);

		frameWindow.receiveReport(minimized, true, () => true);
		frameWindow.attach(next);

		expect(next.pause).toHaveBeenCalledOnce();
	});

	it("neither pauses nor restarts once the visitor has taken over", () => {
		const frameWindow = new FrameWindow();
		const playback = stubPlayback();
		const replace = vi.fn();

		frameWindow.attach(playback);
		frameWindow.hostCallbacksOf(true).onMinimize?.();
		frameWindow.restart(replace);
		frameWindow.stopHolding();
		frameWindow.hostCallbacksOf(false).onMinimize?.();
		frameWindow.recordClick({ isTrusted: true });
		frameWindow.hostCallbacksOf(false).onClose?.();
		frameWindow.receiveReport(closed, false, () => false);
		frameWindow.receiveReport(open, false, () => true);
		runFrames();

		expect(playback.pause).toHaveBeenCalledOnce();
		expect(playback.resume).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
		expect(frameWindow.isRemounted(playback)).toBe(false);
		expect(posted).toHaveBeenLastCalledWith({ type: "close", isDemonstration: false }, window.location.origin);
	});
});
