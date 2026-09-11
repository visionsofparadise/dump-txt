import type { Platform } from "./platformOf";

export function postPlatform(frame: HTMLIFrameElement | null, platform: Platform): void {
	frame?.contentWindow?.postMessage({ type: "platform", platform }, window.location.origin);
}
