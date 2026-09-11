declare global {
	interface Navigator {
		readonly userAgentData?: { readonly platform: string };
	}
}

export type Platform = "windows" | "macos" | "linux";

export function platformOf(navigator: Navigator): Platform {
	const source = navigator.userAgentData?.platform ?? navigator.userAgent;

	if (/mac|iphone|ipad|ipod/iu.test(source)) return "macos";

	if (/linux|android|x11|cros/iu.test(source)) return "linux";

	return "windows";
}
