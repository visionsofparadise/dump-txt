import { describe, expect, it } from "vitest";
import { genieRowOf } from "./playGenie";

const windowBounds = { left: 700, top: 50, width: 600, height: 800 };

const tileBounds = { left: 90, top: 800, width: 32, height: 32 };

describe("genieRowOf", () => {
	it("keeps every row at its place in the window before the warp starts", () => {
		expect(genieRowOf(windowBounds, tileBounds, 0, 0)).toEqual({ left: 700, right: 1300, top: 50 });
		expect(genieRowOf(windowBounds, tileBounds, 0, 400)).toEqual({ left: 700, right: 1300, top: 450 });
	});

	it("gathers every row onto the tile's top edge when the warp ends", () => {
		for (const y of [0, 400, 800])
			expect(genieRowOf(windowBounds, tileBounds, 1, y)).toEqual({ left: 90, right: 122, top: 800 });
	});

	it("leads with the rows nearest a tile below the window's middle", () => {
		const top = genieRowOf(windowBounds, tileBounds, 0.5, 0);
		const bottom = genieRowOf(windowBounds, tileBounds, 0.5, 800);

		expect(bottom.left).toBeLessThan(top.left);
		expect(bottom.right - bottom.left).toBeLessThan(top.right - top.left);
	});

	it("leads with the top rows when the tile sits above the window's middle", () => {
		const tileAbove = { ...tileBounds, top: 10 };
		const top = genieRowOf(windowBounds, tileAbove, 0.5, 0);
		const bottom = genieRowOf(windowBounds, tileAbove, 0.5, 800);

		expect(top.right - top.left).toBeLessThan(bottom.right - bottom.left);
	});
});
