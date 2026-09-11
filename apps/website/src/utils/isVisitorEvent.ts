export function isVisitorEvent(event: Pick<Event, "isTrusted">): boolean {
	return event.isTrusted;
}
