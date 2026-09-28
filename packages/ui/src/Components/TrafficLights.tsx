import { CloseButton } from "./Window/CloseButton";
import { MaximizeButton } from "./Window/MaximizeButton";
import { MinimizeButton } from "./Window/MinimizeButton";
import type { AppContext } from "../models/AppContext";

interface TrafficLightsProps {
	readonly context: AppContext;
}

export function TrafficLights({ context }: TrafficLightsProps) {
	return (
		<div className="col-start-1 row-start-1 flex h-full items-center gap-2 pl-3" data-slot="traffic-lights">
			<CloseButton variant="macos" tone="close" context={context} />
			<MinimizeButton variant="macos" tone="minimize" context={context} />
			<MaximizeButton variant="macos" tone="maximize" context={context} />
		</div>
	);
}
