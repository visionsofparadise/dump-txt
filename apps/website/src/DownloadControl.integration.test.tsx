import type { MotionProps } from "motion/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadControl } from "./DownloadControl";
import type { Platform } from "./utils/platformOf";

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

function downloadOf(name: string, bytes: number): ReleaseDownload {
	return { name, url: `https://github.com/visionsofparadise/dump-txt/releases/download/v0.3.2/${name}`, bytes };
}

const manifest: ReleaseManifest = {
	tag: "v0.3.2",
	version: "0.3.2",
	downloads: {
		windows: { x64: downloadOf("dump-txt-0.3.2-windows-x64.exe", 2_823_057) },
		macos: {
			arm64: downloadOf("dump-txt-0.3.2-mac-arm64.dmg", 3_560_865),
			x64: downloadOf("dump-txt-0.3.2-mac-x64.dmg", 3_744_556),
		},
		linux: {
			appImage: downloadOf("dump-txt-0.3.2-linux-x86_64.AppImage", 79_882_744),
			deb: downloadOf("dump-txt-0.3.2-linux-amd64.deb", 5_096_988),
		},
	},
};

const testEntrance: MotionProps = {
	variants: {
		hidden: { opacity: 0, y: 24 },
		visible: { opacity: 1, y: 0, transition: { duration: 0.03 } },
	},
	initial: "hidden",
	whileInView: "visible",
	viewport: { once: true, amount: 0.15 },
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

async function mount(
	platform: Platform = "windows",
	onPlatformChange: (platform: Platform) => void = () => undefined,
	optionId = "x64",
	release = manifest,
) {
	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	await act(async () => {
		root.render(
			<DownloadControl
				manifest={release}
				platform={platform}
				optionId={optionId}
				onPlatformChange={onPlatformChange}
				onOptionChange={() => undefined}
				entrance={testEntrance}
			/>,
		);
	});
	unmounts.push(() => {
		root.unmount();
	});

	const controls = container.querySelector("#controls");

	if (!controls) throw new Error("The controls element is not mounted.");

	return { container, controls };
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(async () => {
	for (const unmount of unmounts.splice(0)) await act(unmount);

	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("DownloadControl", () => {
	it("holds Windows ARM64 as coming soon until its installer is released", async () => {
		const { controls } = await mount("windows", undefined, "arm64");

		expect(controls.querySelector(".download")?.textContent).toBe("Windows ARM64Coming Soon");
		expect(controls.querySelector(".download")?.hasAttribute("disabled")).toBe(true);
	});

	it("links a published Windows ARM64 installer", async () => {
		const arm64 = downloadOf("dump-txt-0.3.3-windows-arm64.exe", 3_000_000);
		const { controls } = await mount("windows", undefined, "arm64", {
			...manifest,
			downloads: { ...manifest.downloads, windows: { ...manifest.downloads.windows, arm64 } },
		});

		expect(controls.querySelector("a.download")?.getAttribute("href")).toBe(arm64.url);
		expect(controls.textContent).not.toContain("Coming Soon");
	});

	it.each(["ios", "android"] as const)("shows %s as coming soon without offering a download", async (platform) => {
		const onPlatformChange = vi.fn();
		const { controls } = await mount(platform, onPlatformChange);
		const download = controls.querySelector(".download");

		expect(download).toBeInstanceOf(HTMLButtonElement);
		expect(download?.hasAttribute("disabled")).toBe(true);
		expect(download?.textContent).toContain("Coming Soon");
		expect(controls.querySelector("a")).toBeNull();
		expect(controls.querySelector('[aria-label="Architecture"]')).toBeNull();
		expect(controls.querySelector('[aria-label="Platform"]')?.textContent).toBe("iOSAndroid");

		await act(async () => {
			controls.querySelector<HTMLButtonElement>('[aria-label="Desktop"]')?.click();
		});

		expect(onPlatformChange).toHaveBeenCalledWith("windows");
	});

	it("switches to the mobile choices without replacing desktop download links", async () => {
		const onPlatformChange = vi.fn();
		const { controls } = await mount("windows", onPlatformChange);

		expect(controls.querySelector("a.download")?.getAttribute("href")).toBe(manifest.downloads.windows.x64.url);

		await act(async () => {
			controls.querySelector<HTMLButtonElement>('[aria-label="Mobile"]')?.click();
		});

		expect(onPlatformChange).toHaveBeenCalledWith("ios");
	});

	it("holds the controls hidden by its entrance until it intersects the viewport, then reveals it", async () => {
		const { controls } = await mount();

		if (!(controls instanceof HTMLElement)) throw new Error("The controls element is not an HTMLElement.");

		expect(controls.style.opacity).toBe("0");

		await act(async () => {
			MockIntersectionObserver.intersect(controls, true);
		});
		await until(() => controls.style.opacity === "1");

		expect(controls.style.opacity).toBe("1");
	});
});
