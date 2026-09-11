import { describe, expect, it, vi } from "vitest";
import { gpuCompositingOf } from "./gpuCompositingOf";

function documentOf(getContext: (contextId: string, options?: unknown) => unknown): Pick<Document, "createElement"> {
	return { createElement: () => ({ getContext }) } as unknown as Pick<Document, "createElement">;
}

describe("gpuCompositingOf", () => {
	it("reports GPU compositing and releases the probe context when one is returned", () => {
		const loseContext = vi.fn();
		const getExtension = vi.fn(() => ({ loseContext }));
		const getContext = vi.fn(() => ({ getExtension }));

		expect(gpuCompositingOf(documentOf(getContext))).toBe(true);
		expect(getContext).toHaveBeenCalledExactlyOnceWith("webgl", { failIfMajorPerformanceCaveat: true });
		expect(getExtension).toHaveBeenCalledExactlyOnceWith("WEBGL_lose_context");
		expect(loseContext).toHaveBeenCalledOnce();
	});

	it("reports no GPU compositing when the caveat check returns no context", () => {
		const getContext = vi.fn(() => null);

		expect(gpuCompositingOf(documentOf(getContext))).toBe(false);
	});

	it("reports no GPU compositing when the probe throws", () => {
		const getContext = vi.fn(() => {
			throw new Error("WebGL is not supported");
		});

		expect(gpuCompositingOf(documentOf(getContext))).toBe(false);
	});
});
