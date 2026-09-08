import { scope } from "opshot";
import { Layout } from "./Layout";
import { SaveStatus } from "./Page/SaveStatus";
import { TitleBar } from "./TitleBar";
import type { AppContext } from "../models/AppContext";

interface LoaderProps {
	readonly context: AppContext;
}

export const Loader = scope(({ context }: LoaderProps) => {
	const { persistence, persistenceState } = context;
	const generation = persistenceState.generation;
	const dump = persistence.context;

	return dump ? (
		<Layout key={generation} context={dump} />
	) : (
		<main className="loading-app">
			<TitleBar context={context} />
			<div className="loading-copy">Opening dump…</div>
			<SaveStatus context={context} />
		</main>
	);
});
