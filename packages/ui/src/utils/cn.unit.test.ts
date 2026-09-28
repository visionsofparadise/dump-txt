import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
	it("merges two custom spacing keys", () => {
		expect(cn("h-bar", "h-button")).toBe("h-button");
	});

	it("merges a custom shadow key with a static shadow", () => {
		expect(cn("shadow-menu", "shadow-none")).toBe("shadow-none");
	});

	it("merges a custom animation key with a static animation", () => {
		expect(cn("animate-panel-appear", "animate-none")).toBe("animate-none");
	});

	it("keeps a custom text size beside a text colour", () => {
		expect(cn("text-interface", "text-muted-foreground")).toBe("text-interface text-muted-foreground");
	});
});
