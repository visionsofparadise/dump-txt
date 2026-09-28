import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
	it("merges a custom spacing key with a scale value", () => {
		expect(cn("h-bar", "h-10")).toBe("h-10");
	});

	it("merges a custom shadow key with a default shadow", () => {
		expect(cn("shadow-menu", "shadow-md")).toBe("shadow-md");
	});

	it("merges a custom text size with a default text size", () => {
		expect(cn("text-heading", "text-sm")).toBe("text-sm");
	});

	it("keeps a custom text size beside a text colour", () => {
		expect(cn("text-interface", "text-muted-foreground")).toBe("text-interface text-muted-foreground");
	});
});
