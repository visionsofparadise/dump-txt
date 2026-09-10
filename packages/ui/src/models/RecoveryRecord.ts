import { z } from "zod";
import type { ViewSnapshot } from "./SessionState";
import type { TextFormat } from "../utils/decodeText";

const rangeSchema = z.object({ anchor: z.number().int().nonnegative(), head: z.number().int().nonnegative() });

export const pageSelectionSchema = z
	.object({
		ranges: z.array(rangeSchema).min(1),
		mainIndex: z.number().int().nonnegative(),
		scrollTop: z.number(),
	})
	.refine((selection) => selection.mainIndex < selection.ranges.length);

const textFormatSchema = z.object({
	encoding: z.enum(["utf8", "utf16le", "utf16be"]),
	bom: z.boolean(),
	newline: z.enum(["\n", "\r\n", "\r"]),
});

const viewSchema = z.object({
	activePageId: z.string().min(1),
	selections: z.record(z.string(), pageSelectionSchema),
	occurrence: z
		.object({
			seed: z.string(),
			seedPageId: z.string().min(1),
			seedRange: rangeSchema,
			steps: z.number().int().nonnegative(),
			matchCase: z.boolean(),
			allPages: z.boolean(),
			targets: z.array(z.object({ pageId: z.string().min(1), range: rangeSchema })).min(1),
			primaryTarget: z.number().int().nonnegative(),
		})
		.refine((occurrence) => occurrence.primaryTarget < occurrence.targets.length)
		.nullable(),
});

export const recoveryRecordSchema = z.object({
	version: z.literal(1),
	path: z.string().min(1),
	baseHash: z.string().nullable(),
	revision: z.number().int().nonnegative(),
	text: z.string(),
	format: textFormatSchema,
	pageIds: z.array(z.string().min(1)).min(1),
	view: viewSchema,
});

export interface RecoveryRecord {
	readonly version: 1;
	readonly path: string;
	readonly baseHash: string | null;
	readonly revision: number;
	readonly text: string;
	readonly format: TextFormat;
	readonly pageIds: ReadonlyArray<string>;
	readonly view: ViewSnapshot;
}
