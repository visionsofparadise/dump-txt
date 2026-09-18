declare global {
	interface Navigator {
		readonly userAgentData?: { readonly platform: string };
	}
}

export type Platform = "windows" | "macos" | "linux" | "ios" | "android";

export function platformOf(navigator: Navigator): Platform {
	const source = navigator.userAgentData?.platform ?? navigator.userAgent;

	if (/iphone|ipad|ipod|ios/iu.test(source) || (/mac/iu.test(source) && navigator.maxTouchPoints > 1)) return "ios";

	if (/android/iu.test(source)) return "android";

	if (/mac/iu.test(source)) return "macos";

	if (/linux|x11|cros|chrom(?:e|ium) os/iu.test(source)) return "linux";

	return "windows";
}
