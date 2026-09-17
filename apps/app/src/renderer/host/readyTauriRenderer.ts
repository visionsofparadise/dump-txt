import { invokeTauri, nativeVoid } from "./utils/invokeTauri";

export function readyTauriRenderer(): void {
	void invokeTauri("renderer_ready", {}, nativeVoid).catch((error: unknown) => console.error(error));
}
