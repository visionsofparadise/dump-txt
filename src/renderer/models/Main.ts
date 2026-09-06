import type { BridgeCapabilities, MainCapabilities } from "../../shared/ipc/asyncRendererIpcs";
import type { MainEventMap } from "../../shared/utils/emitToRenderer";

export interface Main extends MainCapabilities {
	getSystemFonts(): Promise<ReadonlyArray<string>>;

	readClipboard(): Promise<string>;

	writeClipboard(text: string): Promise<void>;
	readonly events: {
		on<Channel extends keyof MainEventMap>(
			channel: Channel,
			listener: (...parameters: MainEventMap[Channel]) => void,
		): () => void;
	};
}

export interface MainBridge extends BridgeCapabilities {
	readonly events: Main["events"];
}
