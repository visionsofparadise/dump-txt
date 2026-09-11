import { createRef } from "react";
import { playGenie } from "../utils/playGenie";
import { snapshotOf } from "../utils/snapshotOf";
import type { AppWindow, BoxPose, WindowAnimation } from "./AppWindow";
import type { Platform } from "../utils/platformOf";
import type { WindowReport, WindowRequest } from "../utils/windowMessages";

const animationPrefixes: Record<Platform, "win" | "mac" | "gnome"> = { windows: "win", macos: "mac", linux: "gnome" };

const flattenDelay = 150;

const snapshotTimeout = 600;

const animationTimeout = 1500;

async function waitFor(milliseconds: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

export class AppWindowController {
	readonly frame = createRef<HTMLIFrameElement>();
	readonly tile = createRef<HTMLButtonElement>();
	readonly #appWindow: AppWindow;
	#finishing: (() => void) | null = null;
	#queue: Promise<void> = Promise.resolve();
	#isClosedByDemonstration = false;

	constructor(appWindow: AppWindow) {
		this.#appWindow = appWindow;
	}

	pressTile(isVisitor: boolean, platform: Platform): void {
		this.#enqueue(async () => {
			const { state } = this.#appWindow;

			if (state === "open") await this.#minimize(platform);
			else if (state === "minimized") await this.#restore(platform);
			else if (!isVisitor || !this.#isClosedByDemonstration) await this.#open(platform);
		});
	}

	receiveRequest(request: WindowRequest, platform: Platform): void {
		this.#enqueue(async () => {
			if (request.type === "minimize") await this.#minimize(platform);
			else if (request.type === "toggleMaximize") this.#toggleMaximize();
			else if (request.type === "close") await this.#close(request.isDemonstration, platform);
			else if (this.#appWindow.state === "minimized") await this.#restore(platform);
			else await this.#open(platform);
		});
	}

	finishAnimation(): void {
		this.#finishing?.();
	}

	reportWindow(): void {
		const report: WindowReport = {
			type: "window",
			state: this.#appWindow.state,
			isMaximized: this.#appWindow.isMaximized,
		};

		this.frame.current?.contentWindow?.postMessage(report, window.location.origin);
	}

	#enqueue(action: () => Promise<void>): void {
		this.#queue = this.#queue.then(action).catch((error: unknown) => {
			console.error(error);
		});
	}

	#restingPose(): BoxPose {
		return this.#appWindow.isMaximized ? "maximized" : "tilted";
	}

	#animate(animation: WindowAnimation): Promise<void> {
		return new Promise((resolve) => {
			this.#finishing?.();

			const finish = () => {
				clearTimeout(timeout);

				if (this.#finishing === finish) this.#finishing = null;

				resolve();
			};
			const timeout = setTimeout(finish, animationTimeout);

			this.#finishing = finish;
			this.#appWindow.animation = animation;
		});
	}

	#tileOffset(): { x: number; y: number } {
		const tile = this.tile.current?.getBoundingClientRect();
		const app = this.frame.current?.closest("#app")?.getBoundingClientRect();

		if (!tile || !app) return { x: 0, y: 0 };

		return {
			x: Math.round(tile.left + tile.width / 2 - (app.left + app.width / 2)),
			y: Math.round(tile.top + tile.height / 2 - (app.top + app.height / 2)),
		};
	}

	async #playGenie(platform: Platform, isRestore: boolean): Promise<boolean> {
		const frame = this.frame.current;
		const box = frame?.parentElement;
		const layout = box?.parentElement;
		const icon = this.tile.current?.querySelector("img");
		const container = frame?.ownerDocument.getElementById("hero");

		if (platform !== "macos" || matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

		if (!frame || !box || !layout || !icon || !container) return false;

		const isTilted =
			!this.#appWindow.isMaximized && this.#appWindow.pose !== "flat" && getComputedStyle(box).transform !== "none";

		if (isTilted) this.#appWindow.pose = "flat";

		if (isTilted && !isRestore) await waitFor(flattenDelay);

		const snapshot = await snapshotOf(frame, snapshotTimeout);

		if (!snapshot) {
			if (isTilted) this.#appWindow.pose = this.#restingPose();

			return false;
		}

		const { left, top } = layout.getBoundingClientRect();

		this.#appWindow.animation = "mac-hold";
		await playGenie({
			container,
			snapshot,
			windowBounds: { left, top, width: box.offsetWidth, height: box.offsetHeight },
			tileBounds: icon.getBoundingClientRect(),
			radius: this.#appWindow.isMaximized ? 0 : 8,
			isReverse: isRestore,
		});

		return true;
	}

	async #minimize(platform: Platform): Promise<void> {
		if (this.#appWindow.state !== "open") return;

		this.#appWindow.state = "minimized";
		this.reportWindow();

		if (await this.#playGenie(platform, false)) return;

		this.#appWindow.tileOffset = this.#tileOffset();
		await this.#animate(`${animationPrefixes[platform]}-min`);
	}

	async #restore(platform: Platform): Promise<void> {
		if (this.#appWindow.state !== "minimized") return;

		this.#appWindow.state = "open";
		this.reportWindow();

		if (!(await this.#playGenie(platform, true))) {
			this.#appWindow.tileOffset = this.#tileOffset();
			await this.#animate(`${animationPrefixes[platform]}-restore`);
		}

		this.#appWindow.animation = null;

		if (this.#appWindow.pose === "flat")
			requestAnimationFrame(() => {
				this.#appWindow.pose = this.#restingPose();
			});
	}

	async #close(isDemonstration: boolean, platform: Platform): Promise<void> {
		if (this.#appWindow.state !== "open") return;

		this.#isClosedByDemonstration = isDemonstration;
		this.#appWindow.state = "closed";
		await this.#animate(`${animationPrefixes[platform]}-close`);
		this.reportWindow();
	}

	async #open(platform: Platform): Promise<void> {
		if (this.#appWindow.state !== "closed") return;

		this.#isClosedByDemonstration = false;
		this.#appWindow.state = "open";
		this.reportWindow();
		await this.#animate(`${animationPrefixes[platform]}-open`);
		this.#appWindow.animation = null;
	}

	#toggleMaximize(): void {
		if (this.#appWindow.state !== "open") return;

		this.#appWindow.isMaximized = !this.#appWindow.isMaximized;
		this.#appWindow.pose = this.#restingPose();
		this.reportWindow();
	}
}
