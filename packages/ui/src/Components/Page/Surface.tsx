import { cn } from "../../utils/cn";
import type { ComponentProps } from "react";

interface PageSurfaceProps extends ComponentProps<"div"> {
	readonly "data-slot": string;
}

export function PageSurface({ className, ...props }: PageSurfaceProps) {
	return <div className={cn("absolute inset-0 min-h-0 bg-background", className)} {...props} />;
}

interface PageEditorSurfaceProps extends ComponentProps<"div"> {}

export function PageEditorSurface({ className, ...props }: PageEditorSurfaceProps) {
	return <div data-slot="page-editor" className={cn("h-full min-h-0", className)} {...props} />;
}
