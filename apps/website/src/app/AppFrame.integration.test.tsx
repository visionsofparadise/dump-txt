import { webcrypto } from "node:crypto";
import { createPlayback, type PlaybackOptions } from "@dump-txt/rig";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AppFrame } from "./AppFrame";
import type { ChromeContext } from "@dump-txt/ui";

vi.mock("@dump-txt/rig", async (importOriginal) => ({
	...(await importOriginal<typeof import("@dump-txt/rig")>()),
	createPlayback: vi.fn(),
	demonstrate: vi.fn(),
}));

interface StubPlayback {
	readonly options: PlaybackOptions;
	readonly finish: () => void;
	readonly fail: (error: Error) => void;
	readonly pause: Mock<() => void>;
	readonly resume: Mock<() => void>;
	readonly dispose: Mock<() => void>;
}

const nativeFocus = HTMLElement.prototype.focus;
const nativeSelect = HTMLInputElement.prototype.select;
const unmounts: Array<() => Promise<void>> = [];
let playbacks: Array<StubPlayback> = [];

async function settle(): Promise<void> {
	await act(async () => {
		if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
		else
			await new Promise((resolve) => {
				setTimeout(resolve, 10);
			});
	});
}

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
	const deadline = Date.now() + 20_000;

	for (;;) {
		const value = read();

		if (value) return value;

		if (Date.now() > deadline) throw new Error("The condition was never met.");

		await settle();
	}
}

function embedInPage() {
	const host = document.createElement("iframe");

	document.body.append(host);

	const pageDocument = host.contentDocument;
	const pageWindow = pageDocument?.defaultView;
	const frameWindow = document.defaultView;

	if (!pageDocument || !pageWindow || !frameWindow) throw new Error("The page document is missing.");

	const frame = pageDocument.createElement("iframe");
	const download = pageDocument.createElement("a");

	download.href = "#download";
	pageDocument.body.append(download, frame);
	vi.spyOn(frameWindow, "frameElement", "get").mockReturnValue(frame);

	return { host, pageDocument, pageWindow, frame, download };
}

async function mount(search = "?platform=windows") {
	window.history.replaceState(null, "", search);

	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	await act(async () => {
		root.render(<AppFrame />);
	});

	const content = await until(() => container.querySelector<HTMLElement>(".cm-content"));
	const unmount = async () => {
		const index = unmounts.indexOf(unmount);

		if (index >= 0) unmounts.splice(index, 1);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	};

	unmounts.push(unmount);

	const context = (): ChromeContext => {
		const current = playbacks[0]?.options.context();

		if (!current) throw new Error("The app context is not mounted.");

		return current;
	};
	const overlay = () => container.querySelector<HTMLButtonElement>(".appbox-takeover");
	const stage = () => {
		const element = container.querySelector<HTMLElement>(".appbox-stage");

		if (!element) throw new Error("The stage is not mounted.");

		return element;
	};
	const platform = () => container.querySelector(".dump-app")?.getAttribute("data-platform");

	return { container, content, context, overlay, stage, platform, unmount };
}

function pageTextOf(context: ChromeContext): string | undefined {
	return context.document.pages.find((page) => page.id === context.session.view.activePageId)?.text;
}

function platformMessage(platform: string, origin = window.location.origin): MessageEvent {
	return new MessageEvent("message", { data: { type: "platform", platform }, origin });
}

async function reportWindow(state: string, isMaximized: boolean): Promise<void> {
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "window", state, isMaximized },
				origin: window.location.origin,
			}),
		);
	});
}

beforeEach(() => {
	playbacks = [];
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("crypto", webcrypto);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
	Object.defineProperties(Range.prototype, {
		getClientRects: { configurable: true, value: () => [] },
		getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
	});
	vi.mocked(createPlayback).mockImplementation((options) => {
		let finish!: () => void;
		let fail!: (error: Error) => void;
		const played = new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = reject;
		});
		const pause = vi.fn<() => void>();
		const resume = vi.fn<() => void>();
		const dispose = vi.fn<() => void>();

		playbacks.push({ options, finish, fail, pause, resume, dispose });

		return {
			ready: true,
			finished: false,
			error: null,
			play: () => played,
			stop: vi.fn(),
			pause,
			resume,
			dispose,
		};
	});
});

afterEach(async () => {
	vi.useRealTimers();

	for (const unmount of [...unmounts]) await unmount();

	HTMLElement.prototype.focus = nativeFocus;
	HTMLInputElement.prototype.select = nativeSelect;
	document.body.replaceChildren();
	window.history.replaceState(null, "", "/");
	vi.mocked(createPlayback).mockReset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("AppFrame", { timeout: 30_000 }, () => {
	it("skips a focus call inside the stage while the frame's focus rests on the takeover button", async () => {
		const { content, context, overlay } = await mount();
		const takeover = overlay();

		expect(document.activeElement).toBe(content);

		await act(async () => {
			takeover?.focus();
			content.focus();
			context().editor.focus();
		});

		expect(document.activeElement).toBe(takeover);

		await act(async () => {
			takeover?.blur();
		});

		expect(document.activeElement).toBe(document.body);

		await act(async () => {
			context().editor.focus();
		});

		expect(document.activeElement).toBe(content);
	});

	it("skips a focus call inside the stage while the page's focus is outside the frame element", async () => {
		const { host, pageDocument, frame, download } = embedInPage();
		const { content, context } = await mount();

		expect(document.activeElement).toBe(content);

		await act(async () => {
			content.blur();
			download.focus();
			host.blur();
			context().editor.focus();
		});

		expect(pageDocument.activeElement).toBe(download);
		expect(document.activeElement).toBe(document.body);

		await act(async () => {
			frame.focus();
			context().editor.focus();
		});

		expect(pageDocument.activeElement).toBe(frame);
		expect(document.activeElement).toBe(content);

		await act(async () => {
			content.blur();
			frame.blur();
			context().editor.focus();
		});

		expect(pageDocument.activeElement).toBe(pageDocument.body);
		expect(document.activeElement).toBe(content);
	});

	it("skips selecting an input inside the stage while the frame's focus rests on the takeover button", async () => {
		const { content, overlay } = await mount();
		const takeover = overlay();
		const field = document.createElement("input");

		field.value = "Friday";
		content.closest(".demo-stage")?.append(field);

		expect(field.selectionStart).toBe(6);

		takeover?.focus();
		field.select();

		expect(field.selectionStart).toBe(6);
		expect(document.activeElement).toBe(takeover);

		takeover?.blur();
		field.select();

		expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
	});

	it("restores the original focus method after a takeover and after unmount", async () => {
		const first = await mount();

		expect(HTMLElement.prototype.focus).not.toBe(nativeFocus);

		await act(async () => {
			first.overlay()?.click();
		});

		expect(HTMLElement.prototype.focus).toBe(nativeFocus);
		expect(HTMLInputElement.prototype.select).toBe(nativeSelect);
		expect(first.overlay()).toBeNull();

		const editor = await until(() => document.activeElement?.closest(".cm-editor"));

		expect(pageTextOf(first.context())).toBe("");
		expect(editor.closest(".demo-stage")).toBeNull();

		await first.unmount();

		expect(HTMLElement.prototype.focus).toBe(nativeFocus);

		const second = await mount();

		expect(HTMLElement.prototype.focus).not.toBe(nativeFocus);
		expect(HTMLInputElement.prototype.select).not.toBe(nativeSelect);

		await second.unmount();

		expect(HTMLElement.prototype.focus).toBe(nativeFocus);
		expect(HTMLInputElement.prototype.select).toBe(nativeSelect);
	});

	it("passes a Tab keystroke over the stage from the frame and from the page until takeover", async () => {
		const { pageDocument, pageWindow } = embedInPage();
		const { content, context, overlay, stage } = await mount();
		const reached = vi.fn();
		const takeover = overlay();
		const tab = (init: KeyboardEventInit = {}) =>
			new pageWindow.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, ...init });

		content.addEventListener("keydown", reached);
		takeover?.addEventListener("keydown", reached);

		pageDocument.body.dispatchEvent(tab());

		expect(stage().inert).toBe(true);

		await settle();

		expect(stage().inert).toBe(false);

		content.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
		);

		expect(stage().inert).toBe(true);
		expect(reached).not.toHaveBeenCalled();

		await settle();
		takeover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));

		expect(stage().inert).toBe(true);
		expect(reached).toHaveBeenCalledOnce();

		await settle();
		pageDocument.body.dispatchEvent(tab({ ctrlKey: true }));

		expect(stage().inert).toBe(false);
		expect(pageTextOf(context())).toBe("");

		await act(async () => {
			overlay()?.click();
		});
		await until(() => document.activeElement?.closest(".cm-editor"));
		pageDocument.body.dispatchEvent(tab());

		expect(stage().inert).toBe(false);
	});

	it("starts from the platform query and follows platform messages from its own origin", async () => {
		const { platform } = await mount("?platform=linux");

		expect(platform()).toBe("linux");
		expect(createPlayback).toHaveBeenCalledOnce();

		await act(async () => {
			window.dispatchEvent(platformMessage("macos", "https://example.com"));
			window.dispatchEvent(platformMessage("beos"));
			window.dispatchEvent(new MessageEvent("message", { data: "macos", origin: window.location.origin }));
		});
		await settle();

		expect(platform()).toBe("linux");

		await act(async () => {
			window.dispatchEvent(platformMessage("macos"));
		});
		await until(() => platform() === "macos");

		expect(playbacks[0]?.dispose).toHaveBeenCalled();
		expect(createPlayback).toHaveBeenCalledTimes(2);
	});

	it("labels the maximize button restore on a host created while maximized and on a reopened window", async () => {
		const { container, overlay } = await mount();
		const maximizeLabel = () =>
			container.querySelector('[aria-label="Maximize"], [aria-label="Restore window"]')?.getAttribute("aria-label");

		expect(maximizeLabel()).toBe("Maximize");

		await reportWindow("open", true);
		await until(() => maximizeLabel() === "Restore window");

		const editor = container.querySelector(".cm-editor");

		await act(async () => {
			overlay()?.click();
		});
		await until(() => {
			const current = container.querySelector(".cm-editor");

			return current !== editor && current;
		});
		await until(() => maximizeLabel() === "Restore window");
		await reportWindow("closed", true);
		await until(() => container.querySelector(".cm-editor") === null);
		await reportWindow("open", true);
		await until(() => container.querySelector(".cm-editor"));
		await until(() => maximizeLabel() === "Restore window");
	});

	it("keeps the demonstration's application and its open find panel through a visitor's close and open", async () => {
		const { container, context, stage } = await mount();
		const [playback] = playbacks;
		const demonstrated = context();

		await act(async () => {
			demonstrated.editor.openFind();
		});

		const panel = await until(() => container.querySelector(".find-panel"));
		const editor = container.querySelector(".cm-editor");

		await reportWindow("closed", false);

		expect(stage().dataset.window).toBe("closed");
		expect(container.querySelector(".find-panel")).toBe(panel);
		expect(container.querySelector(".cm-editor")).toBe(editor);
		expect(playback?.pause).toHaveBeenCalledOnce();
		expect(playback?.resume).not.toHaveBeenCalled();

		await reportWindow("open", false);

		expect(stage().dataset.window).toBe("open");
		expect(container.querySelector(".find-panel")).toBe(panel);
		expect(container.querySelector(".cm-editor")).toBe(editor);
		expect(context()).toBe(demonstrated);
		expect(playback?.resume).toHaveBeenCalledOnce();
		expect(createPlayback).toHaveBeenCalledOnce();
	});

	it("carries the visitor's text across a platform message after takeover", async () => {
		const { context, overlay, platform } = await mount();

		await act(async () => {
			overlay()?.click();
		});
		await until(() => document.activeElement?.closest(".cm-editor"));
		await act(async () => {
			context().editor.apply({ type: "insert", text: "carried" });
		});
		await until(() => pageTextOf(context()) === "carried");
		await act(async () => {
			window.dispatchEvent(platformMessage("macos"));
		});
		await until(() => platform() === "macos" && pageTextOf(context()) === "carried");

		expect(overlay()).toBeNull();
		expect(createPlayback).toHaveBeenCalledOnce();
	});

	it("remounts a fresh host when a playback resolves", async () => {
		const { container, context } = await mount();
		const [first] = playbacks;
		const guard = HTMLElement.prototype.focus;
		const editor = container.querySelector(".cm-editor");
		const demonstrated = context();

		await act(async () => {
			demonstrated.editor.apply({ type: "insert", text: "demonstrated" });
		});
		await until(() => pageTextOf(demonstrated) === "demonstrated");
		await act(async () => {
			first?.finish();
		});

		const second = await until(() => playbacks[1]);
		const fresh = await until(() => {
			const current = second.options.context();

			return current !== demonstrated && current;
		});

		await until(() => {
			const current = container.querySelector(".cm-editor");

			return current !== editor && current;
		});

		expect(first?.dispose).toHaveBeenCalled();
		expect(pageTextOf(fresh)).toBe("");
		expect(HTMLElement.prototype.focus).toBe(guard);
		expect(createPlayback).toHaveBeenCalledTimes(2);
	});

	it.each<[string, (playback: StubPlayback) => void]>([
		["resolved", (playback) => playback.finish()],
		["failed", (playback) => playback.fail(new Error("Demo target is missing: .page-tab"))],
	])("keeps a takeover made while the restart after a %s playback is pending", async (outcome, settlePlayback) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { container, context, overlay } = await mount();
		const [playback] = playbacks;

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		const pending = vi.getTimerCount();

		await act(async () => {
			if (playback) settlePlayback(playback);
		});

		expect(vi.getTimerCount()).toBeGreaterThan(pending);
		expect(error).toHaveBeenCalledTimes(outcome === "failed" ? 1 : 0);

		await act(async () => {
			overlay()?.click();
		});

		const editor = await until(() => document.activeElement?.closest(".cm-editor"));

		await act(async () => {
			context().editor.apply({ type: "insert", text: "kept" });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		vi.useRealTimers();
		await settle();

		expect(container.querySelector(".cm-editor")).toBe(editor);
		expect(pageTextOf(context())).toBe("kept");
		expect(overlay()).toBeNull();
		expect(createPlayback).toHaveBeenCalledOnce();
	});
});
