import { isVisitorEvent } from "../../utils/isVisitorEvent";
import type { WindowReport, WindowRequest } from "../../utils/windowMessages";
import type { BrowserMainOptions, DemoPlayback } from "@dump-txt/rig";

type HostCallbacks = Pick<BrowserMainOptions, "onMinimize" | "onToggleMaximize" | "onClose">;

function postRequest(request: WindowRequest): void {
	window.parent.postMessage(request, window.location.origin);
}

export class FrameWindow {
	#playback: DemoPlayback | null = null;
	#restart: (() => void) | null = null;
	#isHeld = false;
	#isClosedByDemonstration = false;
	#isVisitorClick = false;
	#isMaximized = false;

	get isMaximized(): boolean {
		return this.#isMaximized;
	}

	hostCallbacksOf(isDemonstrating: boolean): HostCallbacks {
		return {
			onMinimize: () => {
				if (isDemonstrating) this.#hold();

				postRequest({ type: "minimize" });
			},
			onToggleMaximize: () => {
				postRequest({ type: "toggleMaximize" });
			},
			onClose: () => {
				const isDemonstration = isDemonstrating && !this.#isVisitorClick;

				if (isDemonstrating && !isDemonstration) this.#hold();

				this.#isClosedByDemonstration = isDemonstration;
				postRequest({ type: "close", isDemonstration });
			},
		};
	}

	recordClick(event: Pick<Event, "isTrusted">): void {
		this.#isVisitorClick = isVisitorEvent(event);
	}

	isPlaying(playback: DemoPlayback): boolean {
		return this.#playback === playback;
	}

	attach(playback: DemoPlayback): void {
		this.#playback = playback;

		if (this.#isHeld) playback.pause();
	}

	detach(): void {
		this.#playback?.dispose();
		this.#playback = null;
		this.#restart = null;

		if (!this.#isClosedByDemonstration) return;

		this.#isClosedByDemonstration = false;
		postRequest({ type: "open" });
	}

	restart(replace: () => void): void {
		if (this.#isHeld) this.#restart = replace;
		else replace();
	}

	stopHolding(): void {
		this.#isHeld = false;
		this.#restart = null;
	}

	receiveReport(report: WindowReport, isDemonstrating: boolean, isMounted: () => boolean): void {
		this.#isMaximized = report.isMaximized;

		if (report.state === "open") {
			this.#isClosedByDemonstration = false;
			this.#release(isMounted);
		} else if (isDemonstrating && !this.#isClosedByDemonstration) this.#hold();
	}

	#hold(): void {
		this.#isHeld = true;
		this.#playback?.pause();
	}

	#release(isMounted: () => boolean): void {
		if (!this.#isHeld) return;

		this.#isHeld = false;

		const restart = this.#restart;

		this.#restart = null;

		if (restart) {
			restart();

			return;
		}

		const playback = this.#playback;

		const resumeOnceMounted = () => {
			if (this.#playback !== playback || this.#isHeld) return;

			if (isMounted()) playback?.resume();
			else requestAnimationFrame(resumeOnceMounted);
		};

		resumeOnceMounted();
	}
}
