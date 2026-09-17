export const probeText = [
	"dump.txt migration fixture\nSelect this text and edit freely.\ncat cat cat\nCafé · 中文 · 日本語 · 한글 · 👩‍💻",
	Array.from({ length: 240 }, (_, index) => `Line ${index + 1}: a long page for scrolling and selection. cat`).join(
		"\n",
	),
	"Final page\ncat cat\nEnd of the deterministic fixture.",
].join("\n\f\n");
