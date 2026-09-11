import type { Main } from "./Main";

export interface MainCapabilities {
	readonly openDump: boolean;
	readonly saveAs: boolean;
	readonly importPage: boolean;
	readonly exportPage: boolean;
	readonly fonts: boolean;
	readonly minimize: boolean;
	readonly maximize: boolean;
	readonly close: boolean;
}

export const fullCapabilities: MainCapabilities = {
	openDump: true,
	saveAs: true,
	importPage: true,
	exportPage: true,
	fonts: true,
	minimize: true,
	maximize: true,
	close: true,
};

export function capabilitiesOf(main: Pick<Main, "capabilities">): MainCapabilities {
	return main.capabilities ?? fullCapabilities;
}
