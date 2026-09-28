import { Button } from "../UI/Button";
import type { ComponentProps, ReactNode } from "react";

interface BarButtonProps {
	readonly label: string;
	readonly shortcut?: string;
	readonly disabled: boolean;
	readonly variant?: ComponentProps<typeof Button>["variant"];
	readonly offset?: ComponentProps<typeof Button>["offset"];
	readonly onClick: () => void;
	readonly children: ReactNode;
}

export function BarButton({
	label,
	shortcut,
	disabled,
	variant = "chrome",
	offset,
	onClick,
	children,
}: BarButtonProps) {
	return (
		<Button
			variant={variant}
			offset={offset}
			aria-label={label}
			title={shortcut ? `${label} (${shortcut})` : label}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}
