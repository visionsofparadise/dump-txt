import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Website } from "./Website";

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
		root.render(<Website />);
	});
	unmounts.push(() => {
		root.unmount();
	});

	return { container };
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
	vi.stubGlobal("releaseManifest", manifest);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
});

afterEach(async () => {
	for (const unmount of unmounts.splice(0)) await act(unmount);

	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Website", () => {
	it("holds the headline hidden until it intersects the viewport, then reveals it with a fade", async () => {
		const { container } = await mount();
		const headline = container.querySelector("#headline");

		if (!(headline instanceof HTMLElement)) throw new Error("The headline element is not mounted.");

		expect(headline.style.opacity).toBe("0");
		expect(headline.style.transform).toBe("");

		await act(async () => {
			MockIntersectionObserver.intersect(headline, true);
		});
		await until(() => headline.style.opacity === "1");

		expect(headline.style.opacity).toBe("1");
		expect(headline.style.transform).toBe("");
	});

	it("holds the GitHub link hidden until it intersects the viewport, then reveals it", async () => {
		const { container } = await mount();
		const github = container.querySelector("#github");

		if (!(github instanceof HTMLElement)) throw new Error("The GitHub link is not mounted.");

		expect(github.style.opacity).toBe("0");

		await act(async () => {
			MockIntersectionObserver.intersect(github, true);
		});
		await until(() => github.style.opacity === "1");

		expect(github.style.opacity).toBe("1");
	});
});
