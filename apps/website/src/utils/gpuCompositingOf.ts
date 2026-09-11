export function gpuCompositingOf(document: Pick<Document, "createElement">): boolean {
	try {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });

		if (!context) return false;

		context.getExtension("WEBGL_lose_context")?.loseContext();

		return true;
	} catch {
		return false;
	}
}
