import { describe, expect, it } from "vitest";
import { PageTouchGesture, type TouchSample } from "./PageTouchGesture";

const sample = (values: Partial<TouchSample> = {}): TouchSample => ({
	x: 100,
	y: 600,
	top: 1000,
	maximum: 1000,
	height: 700,
	time: 0,
	...values,
});

describe("mobile page edge gestures", () => {
	it("requires edge intent and consumes one page per touch", () => {
		const gesture = new PageTouchGesture();

		gesture.start(sample());

		expect(gesture.move(sample({ y: 350, time: 50 }))).toBeNull();
		expect(gesture.progress).toBeCloseTo(250 / 300);
		expect(gesture.move(sample({ y: 290, time: 70 }))).toBe(1);
		expect(gesture.move(sample({ y: 0, time: 90 }))).toBeNull();
		expect(gesture.progress).toBe(0);
	});

	it("does not count in-page travel and resets immediately on reversal", () => {
		const gesture = new PageTouchGesture();

		gesture.start(sample({ top: 700 }));

		expect(gesture.move(sample({ y: 300, time: 50 }))).toBeNull();
		expect(gesture.progress).toBe(0);
		expect(gesture.move(sample({ y: 100, time: 80 }))).toBeNull();
		expect(gesture.progress).toBeCloseTo(2 / 3);
		expect(gesture.move(sample({ y: 150, top: 950, time: 100 }))).toBeNull();
		expect(gesture.progress).toBe(0);
	});

	it("scales the threshold for a keyboard-reduced viewport", () => {
		const gesture = new PageTouchGesture();

		gesture.start(sample({ top: 0, height: 200, y: 100 }));

		expect(gesture.move(sample({ top: 0, height: 200, y: 210, time: 60 }))).toBe(-1);
	});

	it("leaves horizontal movement, long-press selection and resizing alone", () => {
		for (const next of [
			sample({ x: 300, y: 590, time: 30 }),
			sample({ y: 200, time: 500 }),
			sample({ height: 200, y: 200, time: 30 }),
		]) {
			const gesture = new PageTouchGesture();

			gesture.start(sample());

			expect(gesture.move(next)).toBeNull();
			expect(gesture.move(sample({ y: -400, time: 600 }))).toBeNull();
		}
	});
});
