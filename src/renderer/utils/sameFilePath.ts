export function sameFilePath(left: string, right: string): boolean {
	const windowsPath = /^(?:[a-z]:[/\\]|\\\\)/iu;

	if (!windowsPath.test(left) || !windowsPath.test(right)) return left === right;

	return left.replaceAll("\\", "/").toLowerCase() === right.replaceAll("\\", "/").toLowerCase();
}
