import { PageTouchGesture, type TouchSample } from "../models/PageTouchGesture";
import type { EditorController } from "../models/EditorController";
import type { PageNavigation } from "../models/PageNavigation";

export function observePageTouch(
	element: HTMLElement,
	editor: EditorController,
	navigation: PageNavigation,
): () => void {
	const gesture = new PageTouchGesture();
	let identifier: number | null = null;
	let frame: number | null = null;

	const paint = () => {
		if (frame !== null) return;

		frame = requestAnimationFrame(() => {
			frame = null;

			const surface = element.querySelector<HTMLElement>(".cm-editor");

			surface?.style.setProperty("--overscroll-top", `${Math.max(0, -gesture.progress) * 100}%`);
			surface?.style.setProperty("--overscroll-bottom", `${Math.max(0, gesture.progress) * 100}%`);
		});
	};
	const reset = () => {
		identifier = null;
		gesture.reset();
		paint();
	};
	const sample = (event: TouchEvent): TouchSample | null => {
		const touch = event.touches[0];
		const scroller = element.querySelector<HTMLElement>(".cm-scroller");

		if (event.touches.length !== 1 || !touch || !scroller || !editor.canNavigateByTouch) return null;

		return {
			x: touch.clientX,
			y: touch.clientY,
			top: scroller.scrollTop,
			height: scroller.clientHeight,
			maximum: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
			time: event.timeStamp,
		};
	};
	const start = (event: TouchEvent) => {
		reset();

		const next = sample(event);

		if (!next) return;

		identifier = event.touches[0]?.identifier ?? null;
		gesture.start(next);
	};
	const move = (event: TouchEvent) => {
		const next = sample(event);

		if (!next || identifier === null || event.touches[0]?.identifier !== identifier) {
			reset();

			return;
		}

		const direction = gesture.move(next);

		paint();

		if (direction !== null) {
			reset();
			navigation.navigate(direction, direction > 0 ? "start" : "end");
		}
	};

	element.addEventListener("touchstart", start, { passive: true });
	element.addEventListener("touchmove", move, { passive: true });
	element.addEventListener("touchend", reset, { passive: true });
	element.addEventListener("touchcancel", reset, { passive: true });

	return () => {
		element.removeEventListener("touchstart", start);
		element.removeEventListener("touchmove", move);
		element.removeEventListener("touchend", reset);
		element.removeEventListener("touchcancel", reset);
		reset();

		if (frame !== null) cancelAnimationFrame(frame);

		const surface = element.querySelector<HTMLElement>(".cm-editor");

		surface?.style.removeProperty("--overscroll-top");
		surface?.style.removeProperty("--overscroll-bottom");
	};
}
