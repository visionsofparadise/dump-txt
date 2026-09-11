import type { Platform } from "./platformOf";

export function isPlatform(value: unknown): value is Platform {
	return value === "windows" || value === "macos" || value === "linux";
}
