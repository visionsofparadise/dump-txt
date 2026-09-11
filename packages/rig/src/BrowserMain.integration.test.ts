import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserMain } from "./BrowserMain";

const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

function captureInputs(): Array<HTMLInputElement> {
	const inputs: Array<HTMLInputElement> = [];

	vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
		inputs.push(this);
	});

	return inputs;
}

describe("BrowserMain", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		Object.assign(URL, objectUrls);
	});

	it("declares the operations a static page can honour and draws its own window chrome", () => {
		const main = new BrowserMain();

		expect(main.capabilities).toEqual({
			openDump: false,
			saveAs: false,
			importPage: true,
			exportPage: true,
			fonts: false,
			minimize: true,
			maximize: true,
			close: true,
		});
		expect(main.decorations).toBe("drawn");
	});

	it("forwards window requests to its callbacks and reports maximized changes the page makes", async () => {
		const onMinimize = vi.fn();
		const onToggleMaximize = vi.fn();
		const onClose = vi.fn();
		const main = new BrowserMain({ onMinimize, onToggleMaximize, onClose });
		const changed = vi.fn();

		main.events.on("maximizedChanged", changed);
		await main.minimize();
		await main.toggleMaximize();
		await main.finishClose();

		expect(onMinimize).toHaveBeenCalledOnce();
		expect(onToggleMaximize).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
		expect(changed).not.toHaveBeenCalled();
		expect(main.maximized).toBe(false);

		main.setMaximized(true);
		main.setMaximized(true);

		expect(main.maximized).toBe(true);

		main.setMaximized(false);

		expect(changed.mock.calls).toEqual([[true], [false]]);
	});

	it("exports a page by storing its bytes and downloading them under the page name", async () => {
		const main = new BrowserMain();
		const createObjectURL = vi.fn((_blob: Blob) => "blob:page-2");
		const revokeObjectURL = vi.fn();
		const downloads: Array<string> = [];

		Object.assign(URL, { createObjectURL, revokeObjectURL });
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			downloads.push(this.download);
		});

		const choice = await main.showSaveDialog({ defaultPath: "page-2.txt" });

		expect(choice?.hash).toBeNull();
		expect(choice?.path).toMatch(/^\/memory\/exports\/.+\/page-2\.txt$/u);

		await main.writeFile({ path: choice!.path, bytes: new TextEncoder().encode("Second page"), expectedHash: null });

		expect(new TextDecoder().decode((await main.readFile(choice!.path))?.bytes)).toBe("Second page");
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(await createObjectURL.mock.calls[0]?.[0].text()).toBe("Second page");
		expect(downloads).toEqual(["page-2.txt"]);
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:page-2");
		expect(document.querySelector("a")).toBeNull();
	});

	it("resolves no choice when the file picker is dismissed", async () => {
		const inputs = captureInputs();
		const choice = new BrowserMain().showOpenDialog();

		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.type).toBe("file");

		inputs[0]?.dispatchEvent(new Event("cancel"));

		await expect(choice).resolves.toBeNull();
	});

	it("imports a picked file as a readable memory path", async () => {
		const main = new BrowserMain();
		const inputs = captureInputs();
		const pending = main.showOpenDialog();
		const input = inputs[0]!;

		Object.defineProperty(input, "files", { value: [new File(["Imported page"], "notes.txt")] });
		input.dispatchEvent(new Event("change"));

		const choice = await pending;
		const file = await main.readFile(choice!.path);

		expect(choice?.path).toMatch(/^\/memory\/imports\/.+\/notes\.txt$/u);
		expect(new TextDecoder().decode(file?.bytes)).toBe("Imported page");
		expect(choice?.hash).toBe(file?.hash);
	});
});
