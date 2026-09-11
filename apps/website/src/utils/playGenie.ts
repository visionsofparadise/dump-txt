interface Bounds {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

interface GenieRow {
	readonly left: number;
	readonly right: number;
	readonly top: number;
}

interface GenieOptions {
	readonly container: HTMLElement;
	readonly snapshot: HTMLCanvasElement;
	readonly windowBounds: Bounds;
	readonly tileBounds: Bounds;
	readonly radius: number;
	readonly isReverse: boolean;
}

const genieDuration = 520;

function clampedOf(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function interpolationOf(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}

function easedInOutOf(progress: number): number {
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export function genieRowOf(windowBounds: Bounds, tileBounds: Bounds, progress: number, y: number): GenieRow {
	const isTileBelow = tileBounds.top > windowBounds.top + windowBounds.height / 2;
	const share = y / Math.round(windowBounds.height);
	const lead = isTileBelow ? 1 - share : share;
	const horizontalStart = lead * 0.8;
	const verticalStart = lead * 0.35;
	const horizontal = easedInOutOf(clampedOf((progress - horizontalStart) / (1 - horizontalStart)));
	const vertical = clampedOf((progress - verticalStart) / (1 - verticalStart)) ** 2;

	return {
		left: interpolationOf(windowBounds.left, tileBounds.left, horizontal),
		right: interpolationOf(windowBounds.left + windowBounds.width, tileBounds.left + tileBounds.width, horizontal),
		top: interpolationOf(windowBounds.top + y, tileBounds.top, vertical),
	};
}

export function playGenie({
	container,
	snapshot,
	windowBounds,
	tileBounds,
	radius,
	isReverse,
}: GenieOptions): Promise<void> {
	const owner = container.ownerDocument;
	const view = owner.defaultView ?? window;
	const scale = Math.min(view.devicePixelRatio, 2);
	const source = owner.createElement("canvas");
	const canvas = owner.createElement("canvas");
	const sourceContext = source.getContext("2d");
	const context = canvas.getContext("2d");

	if (!sourceContext || !context) return Promise.resolve();

	const rows = Math.round(windowBounds.height);

	source.width = snapshot.width;
	source.height = snapshot.height;
	sourceContext.beginPath();
	sourceContext.roundRect(0, 0, source.width, source.height, (radius * source.width) / windowBounds.width);
	sourceContext.clip();
	sourceContext.drawImage(snapshot, 0, 0);
	canvas.className = "genie";
	canvas.width = view.innerWidth * scale;
	canvas.height = view.innerHeight * scale;
	container.append(canvas);
	context.scale(scale, scale);
	context.imageSmoothingQuality = "high";

	const sourceRow = source.height / rows;

	return new Promise((resolve) => {
		const startedAt = performance.now();

		const frame = (now: number) => {
			const elapsed = clampedOf((now - startedAt) / genieDuration);
			const progress = isReverse ? 1 - elapsed : elapsed;

			context.clearRect(0, 0, view.innerWidth, view.innerHeight);
			context.globalAlpha = progress > 0.85 ? clampedOf((1 - progress) / 0.15) : 1;

			let row = genieRowOf(windowBounds, tileBounds, progress, 0);

			for (let y = 0; y < rows; y += 1) {
				const next = genieRowOf(windowBounds, tileBounds, progress, y + 1);
				const width = row.right - row.left;

				if (width >= 0.8)
					context.drawImage(
						source,
						0,
						y * sourceRow,
						source.width,
						sourceRow,
						row.left,
						row.top,
						width,
						Math.max(1, Math.abs(next.top - row.top)) + 0.75,
					);

				row = next;
			}

			if (elapsed < 1) {
				requestAnimationFrame(frame);

				return;
			}

			canvas.remove();
			resolve();
		};

		requestAnimationFrame(frame);
	});
}
