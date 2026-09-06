import { z } from "zod";

const windowBoundsSchema = z.object({
	x: z.number().int().min(-100000).max(100000),
	y: z.number().int().min(-100000).max(100000),
	width: z.number().int().min(420).max(10000),
	height: z.number().int().min(280).max(10000),
});

export type WindowBounds = z.infer<typeof windowBoundsSchema>;

export interface MainEventMap {
	closeRequested: [];
	windowBoundsChanged: [bounds: WindowBounds];
	maximizedChanged: [value: boolean];
}

export const mainEventSchemas: { [Channel in keyof MainEventMap]: z.ZodType<MainEventMap[Channel]> } = {
	closeRequested: z.tuple([]),
	windowBoundsChanged: z.tuple([windowBoundsSchema]),
	maximizedChanged: z.tuple([z.boolean()]),
};
