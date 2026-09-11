import { MemoryMain, type MemoryMainOptions } from "./MemoryMain";
import type { Main, MainCapabilities, WriteRequest } from "@dump-txt/ui/host";

const browserCapabilities: MainCapabilities = {
	openDump: false,
	saveAs: false,
	importPage: true,
	exportPage: true,
	fonts: false,
	minimize: true,
	maximize: true,
	close: true,
};

const exportsPath = "/memory/exports/";

export interface BrowserMainOptions extends Omit<MemoryMainOptions, "capabilities"> {
	readonly onMinimize?: () => void;
	readonly onToggleMaximize?: () => void;
}

export class BrowserMain extends MemoryMain {
	readonly decorations: Main["decorations"] = "drawn";
	readonly #onMinimize: (() => void) | undefined;
	readonly #onToggleMaximize: (() => void) | undefined;
	#maximized = false;
	#transfers = 0;

	constructor(options: BrowserMainOptions = {}) {
		const { onMinimize, onToggleMaximize, ...memoryOptions } = options;

		super({ ...memoryOptions, capabilities: browserCapabilities });
		this.#onMinimize = onMinimize;
		this.#onToggleMaximize = onToggleMaximize;
	}

	override get maximized(): boolean {
		return this.#maximized;
	}

	setMaximized(maximized: boolean): void {
		if (maximized === this.#maximized) return;

		this.#maximized = maximized;
		this.emit("maximizedChanged", maximized);
	}

	override minimize(): Promise<void> {
		this.#onMinimize?.();

		return Promise.resolve();
	}

	override toggleMaximize(): Promise<void> {
		this.#onToggleMaximize?.();

		return Promise.resolve();
	}

	override showOpenDialog(): ReturnType<Main["showOpenDialog"]> {
		const input = document.createElement("input");

		input.type = "file";

		const selection = new Promise<File | null>((resolve) => {
			input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
			input.addEventListener("cancel", () => resolve(null), { once: true });
		});

		input.click();

		return selection.then(async (file) => {
			if (!file) return null;

			this.#transfers += 1;

			const path = `/memory/imports/${this.#transfers}/${file.name}`;
			const { hash } = await super.writeFile({
				path,
				bytes: new Uint8Array(await file.arrayBuffer()),
				expectedHash: null,
			});

			return { path, hash };
		});
	}

	override showSaveDialog(options?: Parameters<Main["showSaveDialog"]>[0]): ReturnType<Main["showSaveDialog"]> {
		this.#transfers += 1;

		return Promise.resolve({
			path: `${exportsPath}${this.#transfers}/${options?.defaultPath ?? "page.txt"}`,
			hash: null,
		});
	}

	override async writeFile(request: WriteRequest): ReturnType<Main["writeFile"]> {
		const bytes = new Uint8Array(request.bytes);
		const result = await super.writeFile(request);

		if (request.path.startsWith(exportsPath)) {
			const url = URL.createObjectURL(new Blob([bytes]));
			const anchor = document.createElement("a");

			anchor.href = url;
			anchor.download = request.path.slice(request.path.lastIndexOf("/") + 1);
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
		}

		return result;
	}
}
