import { domToCanvas } from "modern-screenshot";

export async function snapshotOf(frame: HTMLIFrameElement, timeout: number): Promise<HTMLCanvasElement | null> {
	const root = frame.contentDocument?.documentElement;

	if (!root) return null;

	let timer: ReturnType<typeof setTimeout> | undefined;

	const expired = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			resolve(null);
		}, timeout);
	});
	const captured = domToCanvas(root, {
		width: frame.clientWidth,
		height: frame.clientHeight,
		scale: Math.min(window.devicePixelRatio, 2),
		font: false,
		features: { restoreScrollPosition: true },
	}).catch(() => null);

	try {
		return await Promise.race([captured, expired]);
	} finally {
		clearTimeout(timer);
	}
}
