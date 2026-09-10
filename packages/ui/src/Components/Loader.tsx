import { scope } from "opshot";
import { Layout } from "./Layout";
import { SaveStatus } from "./Page/SaveStatus";
import { TitleBar } from "./TitleBar";
import type { AppContext } from "../models/AppContext";
import type { ChromeContext } from "../models/ChromeContext";
import type { Ref, RefObject } from "react";

interface LoaderProps {
	readonly context: AppContext;
	readonly apiRef?: Ref<ChromeContext>;
	readonly surface: RefObject<HTMLDivElement | null>;
}

export const Loader = scope(({ surface, apiRef, context }: LoaderProps) => {
	const { persistence, persistenceState } = context;
	const generation = persistenceState.generation;
	const dump = persistence.context;

	return (
		<div className="dump-ui" ref={surface}>
			{dump ? (
				<Layout key={generation} ref={apiRef} surface={surface} context={dump} />
			) : (
				<main className="loading-app">
					<TitleBar context={context} />
					<div className="loading-copy">Opening dump…</div>
					<SaveStatus context={context} />
				</main>
			)}
		</div>
	);
});
