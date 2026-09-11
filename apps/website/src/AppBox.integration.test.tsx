import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBox } from "./AppBox";
import type { Platform } from "./utils/platformOf";

const unmounts: Array<() => void> = [];

async function mount(platform: Platform) {
	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	await act(async () => {
		root.render(<AppBox platform={platform} />);
	});
	unmounts.push(() => {
		root.unmount();
	});

	const frame = container.querySelector("iframe");

	if (!frame?.contentWindow) throw new Error("The application frame is not mounted.");

	const posted = vi.spyOn(frame.contentWindow, "postMessage");
	const render = async (next: Platform) => {
		await act(async () => {
			root.render(<AppBox platform={next} />);
		});
	};

	return { container, frame, posted, render };
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
});
