import { describe, expect, test } from "vitest";
import { platformOf } from "./platformOf";

function navigatorOf(userAgent: string, platform?: string): Navigator {
	return { userAgent, ...(platform === undefined ? {} : { userAgentData: { platform } }) } as unknown as Navigator;
}

describe("platformOf", () => {
	test.each([
		["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", "windows"],
		["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "macos"],
		["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "macos"],
		["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "macos"],
		["Mozilla/5.0 (iPod touch; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15", "macos"],
		["Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0", "linux"],
		["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36", "linux"],
		["Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", "linux"],
		["Mozilla/5.0 (compatible; UnknownBrowser/1.0)", "windows"],
	])("maps the user agent %s", (userAgent, platform) => {
		expect(platformOf(navigatorOf(userAgent))).toBe(platform);
	});

	test.each([
		["macOS", "macos"],
		["Linux", "linux"],
		["Android", "linux"],
		["Chrome OS", "linux"],
		["Chromium OS", "linux"],
		["Windows", "windows"],
	])("prefers the client hint platform %s", (hint, platform) => {
		expect(platformOf(navigatorOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", hint))).toBe(platform);
	});

	test("reads the client hint over a conflicting user agent", () => {
		expect(platformOf(navigatorOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "macOS"))).toBe("macos");
	});
});
