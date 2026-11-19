/**
 * Where the message list puts its date and unread markers. The list renders a
 * window into all its entries, so these look at the full list: the first
 * rendered entry is not the first entry.
 */

type Entry = {id?: number; time: Date | string | number};

/**
 * Whether entry `index` of `entries` starts a new day. The very first entry
 * does.
 */
export function startsNewDay(entries: Entry[], index: number): boolean {
	const previous = entries[index - 1];

	if (!previous) {
		return true;
	}

	const oldDate = new Date(previous.time);
	const newDate = new Date(entries[index].time);

	return (
		oldDate.getDate() !== newDate.getDate() ||
		oldDate.getMonth() !== newDate.getMonth() ||
		oldDate.getFullYear() !== newDate.getFullYear()
	);
}

/**
 * The index of the entry the unread marker goes in front of: the first one
 * newer than `firstUnread`, so the entry before it in the full list (if any)
 * is not. -1 when there is none.
 */
export function unreadMarkerIndex(entries: Entry[], firstUnread: number): number {
	return entries.findIndex((entry) => Number(entry.id) > firstUnread);
}
