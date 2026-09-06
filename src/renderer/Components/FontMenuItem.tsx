import { useCallback, useMemo } from "react";

interface FontMenuItemProps {
	readonly font: string;
	readonly selected: boolean;
	readonly onSelect: (font: string) => void;
}

export function FontMenuItem({ font, selected, onSelect }: FontMenuItemProps) {
	const style = useMemo(() => ({ fontFamily: JSON.stringify(font) }), [font]);
	const choose = useCallback(() => onSelect(font), [font, onSelect]);

	return (
		<button className="font-option" type="button" role="option" aria-selected={selected} tabIndex={selected ? 0 : -1} style={style} onClick={choose}>
			{font}
		</button>
	);
}
