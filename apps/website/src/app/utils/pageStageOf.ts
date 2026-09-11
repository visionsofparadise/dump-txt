import { pagePointOf } from "../../utils/pagePointOf";
import type { DemoSurface } from "@dump-txt/rig";

interface PageStage {
	readonly stage: HTMLElement;
	readonly origin: { readonly x: number; readonly y: number };
	readonly surfaces: ReadonlyArray<DemoSurface>;
}

export function pageStageOf(element: HTMLElement): PageStage | null {
	const frame = element.ownerDocument.defaultView?.frameElement;
	const pageView = frame?.ownerDocument.defaultView;

	if (!frame || !pageView || !(frame instanceof pageView.HTMLElement)) return null;

	const stage = frame.ownerDocument.getElementById("pointer-stage");
	const taskbar = frame.ownerDocument.getElementById("github");

	if (!stage || !taskbar) return null;

	let x = element.clientWidth * 0.85 - stage.offsetLeft;
	let y = element.clientHeight * 0.9 - stage.offsetTop;
	let offsetElement: Element | null = frame;

	while (offsetElement instanceof pageView.HTMLElement && offsetElement !== stage.offsetParent) {
		x += offsetElement.offsetLeft;
		y += offsetElement.offsetTop;
		offsetElement = offsetElement.offsetParent;
	}

	return {
		stage,
		origin: { x, y },
		surfaces: [
			{ root: element, pointOf: (point) => pagePointOf(frame, point) },
			{ root: taskbar, pointOf: (point) => point, isKeyTarget: false },
		],
	};
}
