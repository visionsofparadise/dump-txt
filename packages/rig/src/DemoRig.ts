import type { ChromeContext } from "@dump-txt/ui";

export class DemoStopped extends Error {
	constructor() {
		super("The demonstration stopped.");
		this.name = "DemoStopped";
	}
}

export interface DemoSurface {
	readonly root: Document | Element;
	readonly pointOf: (point: { readonly x: number; readonly y: number }) => { readonly x: number; readonly y: number };
	readonly isKeyTarget?: boolean;
}

export interface DemoRigOptions {
	readonly origin?: { readonly x: number; readonly y: number };
	readonly stage: HTMLElement;
	readonly pointer: HTMLElement;
	readonly context: () => ChromeContext | null;
	readonly surfaces?: ReadonlyArray<DemoSurface>;
}

interface Hold {
	readonly pause: () => void;
	readonly resume: () => void;
}

function viewOf(element: Element): Window & typeof globalThis {
	return element.ownerDocument.defaultView ?? window;
}

export class DemoRig {
	readonly #options: DemoRigOptions;
	readonly #surfaces: ReadonlyArray<DemoSurface>;
	readonly #pending = new Set<(error: Error) => void>();
	readonly #holds = new Set<Hold>();
	#position: { readonly x: number; readonly y: number };
	#stopped = false;
	#paused = false;

	constructor(options: DemoRigOptions) {
		this.#options = options;
		this.#surfaces = options.surfaces ?? [{ root: options.stage, pointOf: (point) => point }];
		this.#position = this.origin;
		this.#draw();
	}

	get origin(): { readonly x: number; readonly y: number } {
		return this.#options.origin ?? { x: 0, y: 0 };
	}

	get stopped(): boolean {
		return this.#stopped;
	}

	get context(): ChromeContext {
		const context = this.#options.context();

		if (!context) throw new Error("The demo editor is not mounted.");

		return context;
	}

	get text(): string {
		const { document, session } = this.context;

		return document.pages.find((page) => page.id === session.view.activePageId)?.text ?? "";
	}

	stop(): void {
		this.#stopped = true;

		for (const reject of this.#pending) reject(new DemoStopped());

		this.#pending.clear();
	}

	pause(): void {
		if (this.#paused) return;

		this.#paused = true;

		for (const hold of this.#holds) hold.pause();
	}

	resume(): void {
		if (!this.#paused) return;

		this.#paused = false;

		for (const hold of this.#holds) hold.resume();
	}

	async wait(milliseconds: number): Promise<void> {
		this.#assertRunning();

		await new Promise<void>((resolve, reject) => {
			let remaining = milliseconds;
			let startedAt = 0;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const settle = () => {
				this.#pending.delete(cancel);
				this.#holds.delete(hold);
			};
			const start = () => {
				startedAt = performance.now();
				timeout = setTimeout(() => {
					settle();
					resolve();
				}, remaining);
			};
			const hold: Hold = {
				pause: () => {
					clearTimeout(timeout);
					remaining = Math.max(0, remaining - (performance.now() - startedAt));
				},
				resume: start,
			};
			const cancel = (error: Error) => {
				clearTimeout(timeout);
				settle();
				reject(error);
			};

			this.#pending.add(cancel);
			this.#holds.add(hold);

			if (!this.#paused) start();
		});
	}

	element(selector: string): HTMLElement {
		return this.#locate(selector).element;
	}

	async move(target: string | { readonly x: number; readonly y: number }, duration = 450): Promise<void> {
		this.#assertRunning();

		const origin = this.#position;
		const destination = typeof target === "string" ? this.#centreOf(target) : target;
		let started = performance.now();
		let pausedAt = started;
		let isFrameRequested = false;

		await new Promise<void>((resolve, reject) => {
			const settle = () => {
				this.#pending.delete(cancel);
				this.#holds.delete(hold);
			};
			const cancel = (error: Error) => {
				settle();
				reject(error);
			};
			const request = () => {
				isFrameRequested = true;
				requestAnimationFrame(frame);
			};
			const hold: Hold = {
				pause: () => {
					pausedAt = performance.now();
				},
				resume: () => {
					started += performance.now() - pausedAt;

					if (!isFrameRequested) request();
				},
			};
			const frame = () => {
				isFrameRequested = false;

				if (this.#stopped) {
					settle();
					reject(new DemoStopped());

					return;
				}

				if (this.#paused) return;

				const progress = Math.min(1, (performance.now() - started) / duration);
				const eased = progress * progress * (3 - 2 * progress);

				this.#position = {
					x: origin.x + (destination.x - origin.x) * eased,
					y: origin.y + (destination.y - origin.y) * eased,
				};
				this.#draw();

				if (progress < 1) request();
				else {
					settle();
					resolve();
				}
			};

			this.#pending.add(cancel);
			this.#holds.add(hold);
			request();
		});
	}

	async click(selector: string): Promise<void> {
		this.#assertRunning();
		await this.move(selector);

		const element = this.element(selector);

		if (element.matches(":disabled")) throw new Error(`Demo target is disabled: ${selector}`);

		this.#options.pointer.dataset.pressed = "true";
		element.focus();
		element.click();
		await this.wait(150);
		delete this.#options.pointer.dataset.pressed;
		await this.wait(250);
	}

	async type(text: string, interval = 45): Promise<void> {
		this.#assertRunning();
		this.context.editor.focus();

		for (const character of text) {
			this.context.editor.apply({ type: "insert", text: character });
			this.context.editor.revealSelection();
			await this.wait(interval);
		}
	}

	async paste(text: string): Promise<void> {
		this.#assertRunning();
		this.context.editor.focus();
		this.context.editor.apply({ type: "paste", text });
		this.context.editor.revealSelection();
		await this.wait(900);
	}

	async key(key: string, modifiers: KeyboardEventInit = {}): Promise<void> {
		this.#assertRunning();

		const target = this.#activeElement ?? this.element(".cm-content");
		const view = viewOf(target);

		target.dispatchEvent(
			new view.KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...modifiers }),
		);
		await this.wait(350);
	}

	async wheel(deltaY: number, modifiers: WheelEventInit = {}, selector = ".cm-scroller"): Promise<void> {
		this.#assertRunning();
		await this.move(selector);

		const element = this.element(selector);
		const view = viewOf(element);

		element.dispatchEvent(new view.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, ...modifiers }));
		await this.wait(550);
	}

	async select(text: string): Promise<void> {
		this.#assertRunning();

		const anchor = this.text.indexOf(text);

		if (anchor < 0) throw new Error(`Demo selection is missing: ${text}`);

		const { element: content, surface } = this.#locate(".cm-content");
		const owner = content.ownerDocument;
		const walker = owner.createTreeWalker(content, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		let bounds: DOMRect | null = null;

		while (node) {
			const offset = node.textContent?.indexOf(text) ?? -1;

			if (offset >= 0) {
				const range = owner.createRange();

				range.setStart(node, offset);
				range.setEnd(node, offset + text.length);
				bounds = range.getBoundingClientRect();

				break;
			}

			node = walker.nextNode();
		}

		await this.move(
			bounds ? this.#stagePointOf(surface, { x: bounds.left, y: bounds.top + bounds.height / 2 }) : ".cm-content",
		);
		this.#options.pointer.dataset.pressed = "true";
		this.context.editor.select([{ anchor, head: anchor + text.length }]);
		this.context.editor.focus();

		if (bounds)
			await this.move(this.#stagePointOf(surface, { x: bounds.right, y: bounds.top + bounds.height / 2 }), 250);

		delete this.#options.pointer.dataset.pressed;
		await this.wait(700);
	}

	assert(condition: boolean, message: string): void {
		if (!condition) throw new Error(message);
	}

	get #activeElement(): Element | null {
		for (const { root, isKeyTarget = true } of this.#surfaces) {
			if (!isKeyTarget) continue;

			const owner = "documentElement" in root ? root : root.ownerDocument;
			const active = owner.activeElement;

			if (active && active !== owner.body && root.contains(active)) return active;
		}

		return null;
	}

	#locate(selector: string): { readonly element: HTMLElement; readonly surface: DemoSurface } {
		for (const surface of this.#surfaces) {
			const element = surface.root.querySelector<HTMLElement>(selector);

			if (element) return { element, surface };
		}

		throw new Error(`Demo target is missing: ${selector}`);
	}

	#centreOf(selector: string): { readonly x: number; readonly y: number } {
		const { element, surface } = this.#locate(selector);
		const bounds = element.getBoundingClientRect();

		return this.#stagePointOf(surface, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
	}

	#stagePointOf(
		surface: DemoSurface,
		point: { readonly x: number; readonly y: number },
	): { readonly x: number; readonly y: number } {
		const mapped = surface.pointOf(point);
		const stage = this.#options.stage.getBoundingClientRect();

		return { x: mapped.x - stage.left, y: mapped.y - stage.top };
	}

	#assertRunning(): void {
		if (this.#stopped) throw new DemoStopped();
	}

	#draw(): void {
		this.#options.pointer.style.transform = `translate(${this.#position.x}px, ${this.#position.y}px)`;
	}
}
