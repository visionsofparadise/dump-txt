import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { wireWindow } from "./wireWindow";
import type { BrowserWindow } from "electron";

vi.mock("../shared/ipc/asyncMainIpcs", () => ({ ASYNC_MAIN_IPCS: [] }));

function navigationOf(developmentUrl?: string) {
	const webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
	const browserWindow = Object.assign(new EventEmitter(), { webContents });

	wireWindow(
		browserWindow as unknown as BrowserWindow,
		{ userData: "/fixture", restoredFilePath: null, grants: new Set<string>() },
		developmentUrl,
	);

	return (url: string) => {
		const preventDefault = vi.fn();

		webContents.emit("will-navigate", { url, preventDefault });

		return preventDefault;
	};
}

describe("window navigation policy", () => {
	it("allows Vite to reload its exact development entry", () => {
		const navigate = navigationOf("http://localhost:5173");

		expect(navigate("http://localhost:5173/")).not.toHaveBeenCalled();
	});

	it.each([
		"http://localhost:5173/other.html",
		"http://localhost:5173/?redirect=outside",
		"http://localhost:5173/#other",
		"http://localhost:5174/",
		"https://localhost:5173/",
		"http://localhost:5173.evil.test/",
		"http://localhost:5173@evil.test/",
		"file:///fixture/index.html",
		"data:text/html,external",
	])("blocks every other development navigation: %s", (url) => {
		expect(navigationOf("http://localhost:5173/")(url)).toHaveBeenCalledOnce();
	});

	it.each(["http://localhost:5173/", "file:///fixture/index.html", "https://example.com/"])(
		"blocks packaged renderer navigation: %s",
		(url) => {
			expect(navigationOf()(url)).toHaveBeenCalledOnce();
		},
	);
});
