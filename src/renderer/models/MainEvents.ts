import { EventEmitter } from "events";
import type { Main } from "./Main";
import type { MainEventMap } from "../../shared/utils/emitToRenderer";

export class MainEvents extends EventEmitter<MainEventMap> {
	readonly #unsubscribe: ReadonlyArray<() => void>;
	constructor(main: Main) {
		super();
		this.#unsubscribe = [
			main.events.on("closeRequested", () => this.emit("closeRequested")),
			main.events.on("windowBoundsChanged", (bounds) => this.emit("windowBoundsChanged", bounds)),
			main.events.on("maximizedChanged", (value) => this.emit("maximizedChanged", value)),
		];
	}
	dispose(): void {
		for (const unsubscribe of this.#unsubscribe) unsubscribe();

		this.removeAllListeners();
	}
}
