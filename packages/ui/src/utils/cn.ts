import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
	extend: {
		theme: {
			color: [
				"background",
				"foreground",
				"muted-foreground",
				"popover-muted-foreground",
				"muted",
				"chrome",
				"chrome-accent",
				"popover",
				"popover-accent",
				"popover-border",
				"bar",
				"card",
				"border",
				"accent",
				"page-hover",
				"ring",
				"field",
				"field-accent",
				"destructive",
				"destructive-foreground",
				"constructive",
				"constructive-foreground",
				"selection",
				"selection-foreground",
				"selection-muted",
				"overlay",
				"scrollbar",
				"macos-close",
				"macos-minimize",
				"macos-maximize",
				"gnome-button",
				"gnome-button-hover",
				"gnome-foreground",
				"gnome-border",
			],
			font: ["interface", "mono", "title", "gnome"],
			text: ["interface", "secondary", "heading"],
			spacing: ["bar", "button", "icon", "status"],
			shadow: ["menu", "panel", "toast", "dialog", "traffic-light"],
			animate: ["panel-appear"],
		},
	},
});

export function cn(...values: Array<ClassValue>): string {
	return merge(clsx(values));
}
