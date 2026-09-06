import { z } from "zod";

export async function systemFontsOf(): Promise<ReadonlyArray<string>> {
	if (!("queryLocalFonts" in window) || typeof window.queryLocalFonts !== "function")
		throw new Error("Installed fonts are unavailable in this environment.");

	const result: unknown = await window.queryLocalFonts();
	const fonts = z.array(z.object({ family: z.string().min(1) })).parse(result);

	return [...new Set(fonts.map((font) => font.family))].sort((left, right) => left.localeCompare(right));
}
