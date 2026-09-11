import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gpuCompositingOf } from "./utils/gpuCompositingOf";
import { Website } from "./Website";

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

const matchingQueries = new Set<string>();

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

async function pause(milliseconds: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

function elementOf(container: HTMLElement, selector: string): HTMLElement {
	const element = container.querySelector(selector);

	if (!(element instanceof HTMLElement)) throw new Error(`The ${selector} element is not mounted.`);

	return element;
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

	const showApplicationHeader = async () => {
		const frameDocument = container.querySelector("iframe")?.contentDocument;

		if (!frameDocument) throw new Error("The application frame is not mounted.");

		await act(async () => {
			frameDocument.replaceChildren(frameDocument.createElement("header"));
		});
	};

	return { container, showApplicationHeader };
}

async function revealed(section: HTMLElement): Promise<void> {
	await until(() => {
		MockIntersectionObserver.intersect(section, true);

		return section.style.opacity === "1";
	});
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
	vi.stubGlobal("releaseManifest", manifest);
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: matchingQueries.has(query),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
	vi.mocked(gpuCompositingOf).mockReturnValue(false);
	Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
	Object.defineProperty(HTMLImageElement.prototype, "decode", {
		configurable: true,
		value: async () => undefined,
	});
});

afterEach(async () => {
	for (const unmount of unmounts.splice(0)) await act(unmount);

	document.body.replaceChildren();
	matchingQueries.clear();
	Reflect.deleteProperty(document, "fonts");
	Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Website", () => {
	it("layers four tiles of the sky beneath the hills, each from the responsive sources", async () => {
		const { container } = await mount();
		const tiles = container.querySelectorAll("#bg > #sky > img");
		const hills = elementOf(container, "#bg > #hills");

		expect(tiles).toHaveLength(4);

		for (const tile of tiles) expect(tile.getAttribute("srcset")).toMatch(/1280w, .+1920w, .+3840w$/u);

		expect(hills.getAttribute("srcset")).toMatch(/1280w, .+1920w, .+3840w$/u);
		expect(hills.previousElementSibling?.id).toBe("sky");
	});

	it("holds every section hidden until the background images decode and the application header shows", async () => {
		let releaseImages = () => {};
		const images = new Promise<void>((resolve) => {
			releaseImages = resolve;
		});

		Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: async () => images });

		const { container, showApplicationHeader } = await mount();
		const headline = elementOf(container, "#headline");

		MockIntersectionObserver.intersect(headline, true);
		await pause(100);

		expect(headline.style.opacity).toBe("0");

		await act(async () => {
			releaseImages();
		});
		MockIntersectionObserver.intersect(headline, true);
		await pause(100);

		expect(headline.style.opacity).toBe("0");

		await showApplicationHeader();
		await revealed(headline);

		expect(headline.style.opacity).toBe("1");
	});

	it("reveals the GitHub link once the page is ready and the link is in view", async () => {
		const { container, showApplicationHeader } = await mount();
		const github = elementOf(container, "#github");

		expect(github.style.opacity).toBe("0");

		await showApplicationHeader();
		await revealed(github);

		expect(github.style.opacity).toBe("1");
	});

	it("slides the app in from the left and tilts the box in on a desktop with a GPU", async () => {
		vi.mocked(gpuCompositingOf).mockReturnValue(true);

		const { container, showApplicationHeader } = await mount();
		const app = elementOf(container, "#app");
		const box = elementOf(container, "#appbox");

		expect(app.style.transform).toBe("translateX(-160px)");
		expect(box.style.transform).toBe("perspective(2400px)");

		await showApplicationHeader();
		await revealed(app);
		await until(() => box.style.transform === "perspective(2400px) rotateY(-9deg)");

		expect(box.style.transform).toBe("perspective(2400px) rotateY(-9deg)");
	});

	it("raises the app from below without a tilt on a narrow viewport", async () => {
		matchingQueries.add("(max-width: 999px)");
		vi.mocked(gpuCompositingOf).mockReturnValue(true);

		const { container, showApplicationHeader } = await mount();
		const app = elementOf(container, "#app");
		const box = elementOf(container, "#appbox");

		expect(app.style.transform).toBe("translateY(28px)");

		await showApplicationHeader();
		await revealed(app);

		expect(box.style.transform).toBe("");
	});

	it("shows each section at once under reduced motion", async () => {
		matchingQueries.add("(prefers-reduced-motion: reduce)");

		const { container, showApplicationHeader } = await mount();
		const headline = elementOf(container, "#headline");

		await showApplicationHeader();

		const startedAt = Date.now();

		await revealed(headline);

		expect(Date.now() - startedAt).toBeLessThan(1000);
	});
});
