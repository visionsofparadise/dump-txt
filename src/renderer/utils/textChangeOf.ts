export function textChangeOf(before: string, after: string): { from: number; to: number; insert: string } {
	let from = 0;
	let beforeEnd = before.length;
	let afterEnd = after.length;

	while (from < beforeEnd && from < afterEnd && before[from] === after[from]) from++;

	while (beforeEnd > from && afterEnd > from && before[beforeEnd - 1] === after[afterEnd - 1]) {
		beforeEnd--;
		afterEnd--;
	}

	return { from, to: beforeEnd, insert: after.slice(from, afterEnd) };
}
