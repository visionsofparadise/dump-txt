import { Icon } from "lucide-react";

interface MovePageIconProps {
	readonly up: boolean;
}

export function MovePageIcon({ up }: MovePageIconProps) {
	return (
		<Icon
			size={16}
			aria-hidden
			iconNode={[
				["path", { key: "head", d: up ? "m18 11-6-6-6 6" : "m6 13 6 6 6-6" }],
				["path", { key: "stem", d: up ? "M12 5v10" : "M12 19V9" }],
				["path", { key: "line", d: up ? "M5 19h14" : "M5 5h14" }],
			]}
		/>
	);
}
