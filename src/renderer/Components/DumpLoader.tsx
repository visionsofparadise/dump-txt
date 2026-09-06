import { scope } from "opshot";
import { EditorSurface } from "./EditorSurface";
import { SaveStatus } from "./SaveStatus";
import { TitleBar } from "./TitleBar";
import type { AppContext } from "../models/AppContext";

interface DumpLoaderProps {
	readonly context: AppContext;
}

export const DumpLoader = scope(({ context }: DumpLoaderProps) => {
	const { persistence, persistenceState } = context;
	const generation = persistenceState.generation;
	const dump = persistence.context;

	return dump ? (
		<EditorSurface key={generation} context={dump} />
	) : (
		<main className="loading-app">
			<TitleBar context={context} />
			<div className="loading-copy">Opening dump…</div>
			<SaveStatus context={context} />
		</main>
	);
});
