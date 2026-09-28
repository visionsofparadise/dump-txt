import { CloseButton } from "./Window/CloseButton";
import { MaximizeButton } from "./Window/MaximizeButton";
import { MinimizeButton } from "./Window/MinimizeButton";
import type { AppContext } from "../models/AppContext";

interface TrafficLightsProps {
	readonly context: AppContext;
}

export function TrafficLights({ context }: TrafficLightsProps) {
	return (
		<div className="traffic-lights" data-slot="traffic-lights">
			<CloseButton variant="macos" tone="close" context={context} />
			<MinimizeButton variant="macos" tone="minimize" context={context} />
			<MaximizeButton variant="macos" tone="maximize" context={context} />
		</div>
	);
}
