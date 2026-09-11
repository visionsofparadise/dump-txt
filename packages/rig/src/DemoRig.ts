import type { ChromeContext } from "@dump-txt/ui";

export class DemoStopped extends Error {
	constructor() {
		super("The demonstration stopped.");
		this.name = "DemoStopped";
	}
}

export interface DemoRigOptions {
	readonly origin?: { readonly x: number; readonly y: number };
	readonly stage: HTMLElement;
	readonly pointer: HTMLElement;
	readonly context: () => ChromeContext | null;
}

export class DemoRig {
	readonly #options: DemoRigOptions;
	readonly #pending = new Set<(error: Error) => void>();
	#position: { readonly x: number; readonly y: number };
	#stopped = false;

	constructor(options: DemoRigOptions) {
		this.#options = options;
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

	async wait(milliseconds: number): Promise<void> {
		this.#assertRunning();

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.#pending.delete(cancel);
				resolve();
			}, milliseconds);
			const cancel = (error: Error) => {
				clearTimeout(timeout);
				reject(error);
			};

			this.#pending.add(cancel);
		});
	}

	element(selector: string): HTMLElement {
		const element = this.#options.stage.querySelector<HTMLElement>(selector);

		if (!element) throw new Error(`Demo target is missing: ${selector}`);

		return element;
	}

	async move(target: string | { readonly x: number; readonly y: number }, duration = 450): Promise<void> {
		this.#assertRunning();

		const origin = this.#position;
		const stage = this.#options.stage.getBoundingClientRect();
		const bounds = typeof target === "string" ? this.element(target).getBoundingClientRect() : null;
		const destination =
			typeof target === "string" && bounds
				? { x: bounds.left - stage.left + bounds.width / 2, y: bounds.top - stage.top + bounds.height / 2 }
				: typeof target === "string"
					? origin
					: target;
		const started = performance.now();

		await new Promise<void>((resolve, reject) => {
			const cancel = (error: Error) => {
				reject(error);
			};
			const frame = () => {
				if (this.#stopped) {
					this.#pending.delete(cancel);
					reject(new DemoStopped());

					return;
				}

				const progress = Math.min(1, (performance.now() - started) / duration);
				const eased = progress * progress * (3 - 2 * progress);

				this.#position = {
					x: origin.x + (destination.x - origin.x) * eased,
					y: origin.y + (destination.y - origin.y) * eased,
				};
				this.#draw();

				if (progress < 1) requestAnimationFrame(frame);
				else {
					this.#pending.delete(cancel);
					resolve();
				}
			};

			this.#pending.add(cancel);
			requestAnimationFrame(frame);
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

		const { stage } = this.#options;
		const active = stage.ownerDocument.activeElement;
		const target = active && stage.contains(active) ? active : this.element(".cm-content");

		target.dispatchEvent(
			new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...modifiers }),
		);
		await this.wait(350);
	}

	async wheel(deltaY: number, modifiers: WheelEventInit = {}, selector = ".cm-scroller"): Promise<void> {
		this.#assertRunning();
		await this.move(selector);
		this.element(selector).dispatchEvent(
			new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, ...modifiers }),
		);
		await this.wait(550);
	}

	async select(text: string): Promise<void> {
		this.#assertRunning();

		const anchor = this.text.indexOf(text);

		if (anchor < 0) throw new Error(`Demo selection is missing: ${text}`);

		const content = this.element(".cm-content");
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

		const stage = this.#options.stage.getBoundingClientRect();

		await this.move(
			bounds ? { x: bounds.left - stage.left, y: bounds.top - stage.top + bounds.height / 2 } : ".cm-content",
		);
		this.#options.pointer.dataset.pressed = "true";
		this.context.editor.select([{ anchor, head: anchor + text.length }]);
		this.context.editor.focus();

		if (bounds) await this.move({ x: bounds.right - stage.left, y: bounds.top - stage.top + bounds.height / 2 }, 250);

		delete this.#options.pointer.dataset.pressed;
		await this.wait(700);
	}

	assert(condition: boolean, message: string): void {
		if (!condition) throw new Error(message);
	}

	#assertRunning(): void {
		if (this.#stopped) throw new DemoStopped();
	}

	#draw(): void {
		this.#options.pointer.style.transform = `translate(${this.#position.x}px, ${this.#position.y}px)`;
	}
}
