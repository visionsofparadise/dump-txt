import { useMemo } from "react";
import { DropdownMenuRadioItem } from "./UI/DropdownMenu";

interface FontMenuItemProps {
	readonly font: string;
	readonly disabled: boolean;
}

export function FontMenuItem({ font, disabled }: FontMenuItemProps) {
	const style = useMemo(() => ({ fontFamily: font }), [font]);

	return (
		<DropdownMenuRadioItem value={font} disabled={disabled}>
			<span style={style}>{font}</span>
		</DropdownMenuRadioItem>
	);
}
