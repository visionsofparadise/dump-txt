import { useEffect, useMemo } from "react";
import { MainEvents } from "../models/MainEvents";
import { PersistenceController } from "../models/PersistenceController";
import { Loader } from "./Loader";
import type { Main } from "../models/Main";

interface AppProps {
	readonly main: Main;
	readonly onReady?: () => void;
}

export function App({ main, onReady }: AppProps) {
	const context = useMemo(() => {
		const events = new MainEvents(main);
		const persistence = new PersistenceController(main, events);

		return { main, events, persistence, persistenceState: persistence.state };
	}, [main]);

	useEffect(() => {
		void context.persistence.initialize().catch((error: unknown) => console.error(error));
		onReady?.();

		return () => {
			context.persistence.dispose();
			context.events.dispose();
		};
	}, [context, onReady]);

	return <Loader context={context} />;
}
