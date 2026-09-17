export interface TouchSample {
	readonly x: number;
	readonly y: number;
	readonly top: number;
	readonly height: number;
	readonly maximum: number;
	readonly time: number;
}

export class PageTouchGesture {
	#start: TouchSample | null = null;
	#previous: TouchSample | null = null;
	#dragging = false;
	#distance = 0;
	#direction: -1 | 0 | 1 = 0;

	get progress(): number {
		return this.#previous && this.#distance > 0
			? (this.#direction * this.#distance) / Math.max(1, Math.min(300, this.#previous.height / 2))
			: 0;
	}

	start(sample: TouchSample): void {
		this.reset();
		this.#start = sample;
		this.#previous = sample;
	}

	reset(): void {
		this.#start = null;
		this.#previous = null;
		this.#dragging = false;
		this.#distance = 0;
		this.#direction = 0;
	}

	move(sample: TouchSample): -1 | 1 | null {
		const start = this.#start;
		const previous = this.#previous;

		if (!start || !previous) return null;

		const horizontal = Math.abs(sample.x - start.x);
		const vertical = Math.abs(sample.y - start.y);

		if (sample.height !== previous.height || (!this.#dragging && sample.time - start.time >= 450)) {
			this.reset();

			return null;
		}

		if (!this.#dragging && Math.max(horizontal, vertical) < 10) return null;

		if (!this.#dragging && horizontal > vertical) {
			this.reset();

			return null;
		}

		this.#dragging = true;
		this.#previous = sample;

		const delta = previous.y - sample.y;

		if (delta === 0) return null;

		const direction = delta > 0 ? 1 : -1;
		const edge =
			direction > 0
				? previous.top >= previous.maximum - 1 && sample.top >= sample.maximum - 1
				: previous.top <= 1 && sample.top <= 1;

		if (direction !== this.#direction || !edge) this.#distance = 0;

		this.#direction = direction;

		if (!edge) return null;

		this.#distance += Math.abs(delta);

		if (Math.abs(this.progress) < 1) return null;

		this.reset();

		return direction;
	}
}
