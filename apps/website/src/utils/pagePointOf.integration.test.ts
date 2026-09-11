import { afterEach, describe, expect, it, vi } from "vitest";
import { pagePointOf } from "./pagePointOf";

class StubPoint {
	constructor(
		readonly x = 0,
		readonly y = 0,
		readonly z = 0,
		readonly w = 1,
	) {}
}

class StubMatrix {
	readonly values: ReadonlyArray<number>;

	constructor(transform?: string) {
		this.values = transform
			? transform
					.slice(transform.indexOf("(") + 1, -1)
					.split(",")
					.map(Number)
			: [1, 0, 0, 1, 0, 0];
	}

	transformPoint(point: StubPoint): StubPoint {
		const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0, w = 1] = this.values;

		return new StubPoint(a * point.x + c * point.y + e, b * point.x + d * point.y + f, 0, w);
	}
}

function frameIn(transform: string): HTMLIFrameElement {
	const layout = document.createElement("div");
	const box = document.createElement("div");
	const frame = document.createElement("iframe");

	box.append(frame);
	layout.append(box);
	document.body.append(layout);
	vi.spyOn(layout, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 600, 400));
	vi.spyOn(window, "getComputedStyle").mockReturnValue({
		transform,
		transformOrigin: "600px 200px",
	} as CSSStyleDeclaration);
	vi.stubGlobal("DOMMatrix", StubMatrix);
	vi.stubGlobal("DOMPoint", StubPoint);

	return frame;
}

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("pagePointOf", () => {
	it("offsets a frame point by the box's layout position when the box has no transform", () => {
		expect(pagePointOf(frameIn("none"), { x: 100, y: 50 })).toEqual({ x: 110, y: 70 });
	});

	it("transforms a frame point about the box's origin before placing it on the page", () => {
		expect(pagePointOf(frameIn("matrix(2, 0, 0, 2, 0, 0)"), { x: 100, y: 50 })).toEqual({ x: -390, y: -80 });
	});

	it("divides a projected point by its perspective weight", () => {
		expect(pagePointOf(frameIn("matrix(1, 0, 0, 1, 0, 0, 2)"), { x: 100, y: 50 })).toEqual({ x: 360, y: 145 });
	});
});
