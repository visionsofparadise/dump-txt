import { contentHashOf, IpcError } from "@dump-txt/ui/host";
import type { AppState, Main, MainCapabilities, MainEventMap, WriteRequest } from "@dump-txt/ui/host";

export interface MemoryMainOptions {
	readonly onClose?: () => void;
	readonly text?: string;
	readonly theme?: AppState["appearance"]["theme"];
	readonly font?: string;
	readonly textSize?: number;
	readonly showStatusBar?: boolean;
	readonly platform?: Main["platform"];
	readonly capabilities?: MainCapabilities;
}

export class MemoryMain implements Main {
	readonly platform: Main["platform"];
	readonly capabilities: MainCapabilities | undefined;
	readonly #files = new Map<string, Uint8Array>();
	readonly #listeners: {
		[Channel in keyof MainEventMap]: Set<(...parameters: MainEventMap[Channel]) => void>;
	} = {
		closeRequested: new Set(),
		windowBoundsChanged: new Set(),
		maximizedChanged: new Set(),
	};
	readonly #onClose: (() => void) | undefined;
	#writes = Promise.resolve();
	#clipboard = "";
	#maximized = false;
	#title = "dump.txt";
	#theme: AppState["appearance"]["theme"];
	readonly events: Main["events"] = {
		on: (channel, listener) => {
			this.#listeners[channel].add(listener);

			return () => {
				this.#listeners[channel].delete(listener);
			};
		},
	};

	constructor(options: MemoryMainOptions = {}) {
		this.platform = options.platform ?? "windows";
		this.capabilities = options.capabilities;
		this.#onClose = options.onClose;
		this.#theme = options.theme ?? "dark";

		const state: AppState = {
			version: 1,
			activePath: "/memory/dump.txt",
			appearance: {
				theme: this.#theme,
				font: options.font ?? "Consolas",
				textSize: options.textSize ?? 11,
				showStatusBar: options.showStatusBar ?? true,
			},
			findPreferences: { matchCase: false, allPages: false },
			occurrencePreferences: { matchCase: true, allPages: false },
			windowBounds: null,
			savedContentHash: null,
			activePageIndex: 0,
			selections: [],
		};
		const encoder = new TextEncoder();

		this.#files.set(state.activePath, encoder.encode(options.text ?? ""));
		this.#files.set("/memory/app-state.json", encoder.encode(JSON.stringify(state)));
	}

	get title(): string {
		return this.#title;
	}

	get theme(): AppState["appearance"]["theme"] {
		return this.#theme;
	}

	get maximized(): boolean {
		return this.#maximized;
	}

	emit<Channel extends keyof MainEventMap>(channel: Channel, ...parameters: MainEventMap[Channel]): void {
		for (const listener of this.#listeners[channel]) listener(...parameters);
	}

	async getPaths(): ReturnType<Main["getPaths"]> {
		return {
			userData: "/memory",
			restoredFilePath: null,
			startupSettings: await this.readFile("/memory/app-state.json"),
		};
	}

	async readFile(path: string): ReturnType<Main["readFile"]> {
		await this.#writes;

		const stored = this.#files.get(path);
		const bytes = stored ? new Uint8Array(stored) : null;

		return bytes ? { bytes, hash: await contentHashOf(bytes) } : null;
	}

	writeFile(request: WriteRequest): ReturnType<Main["writeFile"]> {
		const bytes = new Uint8Array(request.bytes);
		const { path, expectedHash } = request;
		const result = this.#writes.then(async () => {
			const previous = this.#files.get(path);
			const previousHash = previous ? await contentHashOf(previous) : null;

			if (previousHash !== expectedHash)
				throw new IpcError({ code: previous ? "conflict" : "missing", message: "The memory file has changed." });

			const hash = await contentHashOf(bytes);

			this.#files.set(path, bytes);

			return { hash };
		});

		this.#writes = result.then(
			() => undefined,
			() => undefined,
		);

		return result;
	}

	showOpenDialog(): ReturnType<Main["showOpenDialog"]> {
		return Promise.resolve(null);
	}

	showSaveDialog(): ReturnType<Main["showSaveDialog"]> {
		return Promise.resolve(null);
	}

	minimize(): Promise<void> {
		return Promise.resolve();
	}

	toggleMaximize(): Promise<void> {
		this.#maximized = !this.#maximized;
		this.emit("maximizedChanged", this.#maximized);

		return Promise.resolve();
	}

	setTitle(title: string): Promise<void> {
		this.#title = title;

		return Promise.resolve();
	}

	setTheme(theme: AppState["appearance"]["theme"]): Promise<void> {
		this.#theme = theme;

		return Promise.resolve();
	}

	async finishClose(): Promise<void> {
		await this.#writes;

		this.#onClose?.();
	}

	showTextContextMenu(): ReturnType<Main["showTextContextMenu"]> {
		return Promise.resolve(null);
	}

	getSystemFonts(): ReturnType<Main["getSystemFonts"]> {
		return Promise.resolve(["Arial", "Consolas", "Courier New", "monospace"]);
	}

	readClipboard(): Promise<string> {
		return Promise.resolve(this.#clipboard);
	}

	writeClipboard(text: string): Promise<void> {
		this.#clipboard = text;

		return Promise.resolve();
	}
}
