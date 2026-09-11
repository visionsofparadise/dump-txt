import type { Variants } from "motion/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBox } from "./AppBox";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import type { Platform } from "./utils/platformOf";

vi.mock("./utils/gpuCompositingOf", () => ({ gpuCompositingOf: vi.fn() }));

class MockIntersectionObserver implements IntersectionObserver {
	static instances: Array<MockIntersectionObserver> = [];

	readonly root = null;
	readonly rootMargin = "";
	readonly scrollMargin = "";
	readonly thresholds: ReadonlyArray<number> = [];

	constructor(private readonly callback: IntersectionObserverCallback) {
		MockIntersectionObserver.instances.push(this);
	}

	observe(): void {}

	unobserve(): void {}

	disconnect(): void {}

	takeRecords(): Array<IntersectionObserverEntry> {
		return [];
	}

	static intersect(target: Element, isIntersecting: boolean): void {
		const entry = { target, isIntersecting } as IntersectionObserverEntry;

		for (const instance of MockIntersectionObserver.instances) instance.callback([entry], instance);
	}
}

const testVariants: Variants = {
	hidden: { opacity: 0, x: 24 },
	visible: { opacity: 1, x: 0, transition: { duration: 0.03 } },
};

const unmounts: Array<() => void> = [];

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
	const deadline = Date.now() + 5000;

	for (;;) {
		const value = read();

		if (value) return value;

		if (Date.now() > deadline) throw new Error("The condition was never met.");

		await new Promise((resolve) => {
			setTimeout(resolve, 10);
		});
	}
}

async function mount(platform: Platform, variants: Variants = testVariants) {
	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	await act(async () => {
		root.render(<AppBox platform={platform} variants={variants} />);
	});
	unmounts.push(() => {
		root.unmount();
	});

	const frame = container.querySelector("iframe");

	if (!frame?.contentWindow) throw new Error("The application frame is not mounted.");

	const posted = vi.spyOn(frame.contentWindow, "postMessage");
	const render = async (next: Platform) => {
		await act(async () => {
			root.render(<AppBox platform={next} variants={variants} />);
		});
	};

	return { container, frame, posted, render };
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
	vi.mocked(gpuCompositingOf).mockReturnValue(false);
});

afterEach(async () => {
	for (const unmount of unmounts.splice(0)) await act(unmount);

	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("AppBox", () => {
	it("frames the application page for the initial platform and keeps that source across platform changes", async () => {
		const { container, frame, render } = await mount("linux");

		expect(frame.getAttribute("src")).toBe("app.html?platform=linux");
		expect(frame.title).toBe("dump.txt");
		expect(frame.closest("#appbox")?.closest("#app")).toBe(container.firstElementChild);

		await render("macos");

		expect(container.querySelector("iframe")).toBe(frame);
		expect(frame.getAttribute("src")).toBe("app.html?platform=linux");
	});

	it("posts each platform change and the current platform on load to the frame at the page origin", async () => {
		const { frame, posted, render } = await mount("windows");

		await render("macos");

		expect(posted).toHaveBeenLastCalledWith({ type: "platform", platform: "macos" }, window.location.origin);

		await render("linux");

		expect(posted).toHaveBeenLastCalledWith({ type: "platform", platform: "linux" }, window.location.origin);

		posted.mockClear();
		await act(async () => {
			frame.dispatchEvent(new Event("load"));
		});

		expect(posted).toHaveBeenCalledExactlyOnceWith({ type: "platform", platform: "linux" }, window.location.origin);
	});

	it("carries the GPU compositing marker on the box when a GPU context is detected", async () => {
		vi.mocked(gpuCompositingOf).mockReturnValue(true);

		const { container } = await mount("windows");

		expect(container.querySelector("#appbox")?.getAttribute("data-gpu-compositing")).toBe("true");
	});

	it("carries the GPU compositing marker on the box when no GPU context is detected", async () => {
		vi.mocked(gpuCompositingOf).mockReturnValue(false);

		const { container } = await mount("windows");

		expect(container.querySelector("#appbox")?.getAttribute("data-gpu-compositing")).toBe("false");
	});

	it("holds the app hidden by its entrance variants until it intersects the viewport, then reveals it", async () => {
		const { container } = await mount("windows");
		const app = container.querySelector("#app");

		if (!app) throw new Error("The app element is not mounted.");

		expect(app instanceof HTMLElement && app.style.opacity).toBe("0");

		await act(async () => {
			MockIntersectionObserver.intersect(app, true);
		});
		await until(() => app instanceof HTMLElement && app.style.opacity === "1");

		expect(app instanceof HTMLElement && app.style.opacity).toBe("1");
	});
});
