import { z } from "zod";
import { pageSelectionSchema } from "./RecoveryRecord";
import type { PageSelection, SessionState } from "./SessionState";
import type { WindowBounds } from "../../shared/models/MainEventMap";

const preferencesSchema = z.object({ matchCase: z.boolean(), allPages: z.boolean() });

export const appStateSchema = z.object({
	version: z.literal(1),
	activePath: z.string().min(1),
	appearance: z.object({
		theme: z.enum(["system", "light", "dark"]),
		font: z.string().min(1).max(100),
		textSize: z.number().min(8).max(24),
		showStatusBar: z.boolean().default(true),
	}),
	findPreferences: preferencesSchema,
	occurrencePreferences: preferencesSchema,
	windowBounds: z
		.object({
			x: z.number().int(),
			y: z.number().int(),
			width: z.number().int().min(420),
			height: z.number().int().min(280),
		})
		.nullable(),
	savedContentHash: z.string().nullable(),
	activePageIndex: z.number().int().nonnegative(),
	selections: z.array(pageSelectionSchema),
});

export interface AppState {
	readonly version: 1;
	readonly activePath: string;
	readonly appearance: SessionState["appearance"];
	readonly findPreferences: SessionState["occurrencePreferences"];
	readonly occurrencePreferences: SessionState["occurrencePreferences"];
	readonly windowBounds: WindowBounds | null;
	readonly savedContentHash: string | null;
	readonly activePageIndex: number;
	readonly selections: ReadonlyArray<PageSelection>;
}
