import { useEffect, useMemo, useRef, type Ref } from "react";
import { MainEvents } from "../models/MainEvents";
import { PersistenceController } from "../models/PersistenceController";
import { Loader } from "./Loader";
import type { ChromeContext } from "../models/ChromeContext";
import type { Main } from "../models/Main";

export interface AppProps {
	readonly main: Main;
	readonly onReady?: () => void;
	readonly ref?: Ref<ChromeContext>;
}

export function App({ main, onReady, ref }: AppProps) {
	const surface = useRef<HTMLDivElement>(null);

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

	return <Loader surface={surface} apiRef={ref} context={context} />;
}
