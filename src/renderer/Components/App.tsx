import { useEffect, useMemo } from "react";
import { createMain } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import { PersistenceController } from "../models/PersistenceController";
import { DumpLoader } from "./DumpLoader";

export function App() {
	const context = useMemo(() => {
		const main = createMain(window.main);
		const events = new MainEvents(main);
		const persistence = new PersistenceController(main, events);

		return { main, events, persistence, persistenceState: persistence.state };
	}, []);

	useEffect(() => {
		void context.persistence.initialize().catch((error: unknown) => console.error(error));

		return () => {
			context.persistence.dispose();
			context.events.dispose();
		};
	}, [context]);

	return <DumpLoader context={context} />;
}
