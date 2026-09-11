import type { MotionProps } from "motion/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadControl } from "./DownloadControl";

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

async function mount() {
	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	await act(async () => {
		root.render(
			<DownloadControl
				manifest={manifest}
				platform="windows"
				optionId="x64"
				onPlatformChange={() => undefined}
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
