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

	it("declares the operations a static page can honour", () => {
		expect(new BrowserMain().capabilities).toEqual({
			openDump: false,
			saveAs: false,
			importPage: true,
			exportPage: true,
			fonts: false,
			minimize: false,
			maximize: false,
			close: false,
		});
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
