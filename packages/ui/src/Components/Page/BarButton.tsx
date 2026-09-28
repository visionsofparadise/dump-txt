import type { ReactNode } from "react";

interface BarButtonProps {
	readonly label: string;
	readonly shortcut?: string;
	readonly disabled: boolean;
	readonly className?: string;
	readonly onClick: () => void;
	readonly children: ReactNode;
}

export function BarButton({
	label,
	shortcut,
	disabled,
	className = "chrome-button",
	onClick,
	children,
}: BarButtonProps) {
	return (
		<button
			className={className}
			aria-label={label}
			title={shortcut ? `${label} (${shortcut})` : label}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
