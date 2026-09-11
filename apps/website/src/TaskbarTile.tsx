import { scope } from "opshot";
import icon from "../../desktop/assets/icon.svg";
import { tileLabels } from "./utils/tileLabels";
import type { AppWindowControl } from "./hooks/useAppWindow";

interface TaskbarTileProps {
	readonly control: AppWindowControl;
}

export const TaskbarTile = scope(({ control }: TaskbarTileProps) => {
	const { appWindow, tile, pressTile } = control;
	const label = tileLabels[appWindow.state];

	return (
		<button
			ref={tile}
			id="tile"
			type="button"
			data-window={appWindow.state}
			aria-label={label}
			title={label}
			onClick={pressTile}
		>
			<img src={icon} alt="" width={32} height={32} draggable={false} />
		</button>
	);
});
