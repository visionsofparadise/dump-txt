import type { Page } from "../models/DocumentState";

export function serializePages(pages: ReadonlyArray<Page>): string {
	return pages.map((page) => page.text).join("\n\f\n");
}
