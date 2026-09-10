import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...values: Array<ClassValue>): string {
	return twMerge(clsx(values));
}
