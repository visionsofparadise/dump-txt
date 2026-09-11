import { CloseButton } from "./Window/CloseButton";
import { MaximizeButton } from "./Window/MaximizeButton";
import { MinimizeButton } from "./Window/MinimizeButton";
import type { AppContext } from "../models/AppContext";

interface TrafficLightsProps {
	readonly context: AppContext;
}

export function TrafficLights({ context }: TrafficLightsProps) {
	return (
		<div className="traffic-lights">
			<CloseButton className="traffic-light traffic-light-close" context={context} />
			<MinimizeButton className="traffic-light traffic-light-minimize" context={context} />
			<MaximizeButton className="traffic-light traffic-light-maximize" context={context} />
		</div>
	);
}
