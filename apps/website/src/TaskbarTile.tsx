import { scope } from "opshot";
import icon from "../../desktop/assets/icon.svg";
import type { AppWindowControl } from "./hooks/useAppWindow";
import type { WindowState } from "./utils/windowMessages";

interface TaskbarTileProps {
	readonly control: AppWindowControl;
}

const tileLabels: Record<WindowState, string> = {
	open: "Minimize dump.txt",
	minimized: "Restore dump.txt",
	closed: "Open dump.txt",
};

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
