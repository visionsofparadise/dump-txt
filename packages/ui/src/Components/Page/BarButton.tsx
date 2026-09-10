import { cn } from "../../utils/cn";
import type { ReactNode } from "react";

interface BarButtonProps {
	readonly label: string;
	readonly shortcut?: string;
	readonly disabled: boolean;
	readonly hidden?: boolean;
	readonly className?: string;
	readonly onClick: () => void;
	readonly children: ReactNode;
}

export function BarButton({
	label,
	shortcut,
	disabled,
	hidden,
	className = "chrome-button",
	onClick,
	children,
}: BarButtonProps) {
	return (
		<button
			className={cn(className, hidden && "page-nav-hidden")}
			aria-label={label}
			title={shortcut ? `${label} (${shortcut})` : label}
			aria-hidden={hidden}
			tabIndex={hidden ? -1 : undefined}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
