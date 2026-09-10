import type { Main } from "./Main";
import type { MainEvents } from "./MainEvents";
import type { PersistenceController } from "./PersistenceController";

export interface AppContext {
	readonly main: Main;
	readonly events: MainEvents;
	readonly persistence: PersistenceController;
	readonly persistenceState: PersistenceController["state"];
}
