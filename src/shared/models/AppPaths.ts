import { z } from "zod";
import { fileReadSchema, type FileRead } from "./FileRead";

export interface AppPaths {
	readonly userData: string;
	readonly restoredFilePath: string | null;
	readonly startupSettings?: FileRead | null;
}

export const appPathsSchema = z.object({
	userData: z.string(),
	restoredFilePath: z.string().nullable(),
	startupSettings: fileReadSchema.nullable().optional(),
});
