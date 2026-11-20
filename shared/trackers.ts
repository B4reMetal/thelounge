// Placeholder in a tracker's `profileUrl` that the nick is put in place of
export const trackerNickPlaceholder = "{nick}";
// Placeholder for the user's ident, on trackers where that is their user id
export const trackerIdentPlaceholder = "{ident}";

/**
 * A profile address the client can turn into a link: http(s), with a place
 * for the nick or the ident. Used for the trackers in config.js and for the
 * ones users add in their settings alike.
 */
export function isUsableProfileUrl(url: unknown): url is string {
	if (
		typeof url !== "string" ||
		!(url.includes(trackerNickPlaceholder) || url.includes(trackerIdentPlaceholder))
	) {
		return false;
	}

	try {
		const {protocol} = new URL(
			url.replace(trackerNickPlaceholder, "nick").replace(trackerIdentPlaceholder, "1")
		);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

/**
 * An avatar address the server can hand to a fetcher: https only, with a place
 * for the nick.
 */
export function isUsableAvatarUrl(url: unknown): url is string {
	if (typeof url !== "string" || !url.includes(trackerNickPlaceholder)) {
		return false;
	}

	try {
		return new URL(url.replace(trackerNickPlaceholder, "nick")).protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * A tracker entry from a user's own settings (`userTrackers`). One whose `id`
 * and `network` are those of a tracker from config.js changes that tracker's
 * profile link for this user (or hides it); any other adds a tracker.
 *
 * These only ever feed "Tracker Profile" links. Shoutbox bridge matchers are
 * scoped by the server's list alone, so a user can't make one apply.
 */
export type UserTracker = {
	id: string;
	// The network's `trackerKey`: stands for its IRC server host, which the
	// client isn't told. An entry whose key matches none of the user's
	// networks does nothing.
	network: string;
	name?: string;
	channels?: string[];
	profileUrl?: string;
	userHost?: string;
	// Hides the profile link of the server's tracker with this id
	hidden?: boolean;
};

// Name of the client setting the entries are kept in, as a JSON string
export const userTrackersSetting = "userTrackers";

// Limits that keep the stored setting small
export const userTrackerLimits = {
	entries: 50,
	channels: 20,
	text: 100,
	url: 500,
	// Upper bound for the whole stored value, checked by the server
	storedLength: 32 * 1024,
};

const text = (value: unknown, max = userTrackerLimits.text) =>
	typeof value === "string" && value.trim() !== "" && value.length <= max
		? value.trim()
		: undefined;

/**
 * Reads one stored entry. Returns null for anything that isn't a usable entry.
 * A profile address that isn't usable (see isUsableProfileUrl) is dropped, so
 * no link is ever built from it, however it got stored.
 */
export function parseUserTracker(value: unknown): UserTracker | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}

	const raw = value as Record<string, unknown>;
	const id = text(raw.id);
	const network = text(raw.network);

	if (!id || !network) {
		return null;
	}

	const entry: UserTracker = {id, network: network.toLowerCase()};

	const name = text(raw.name);

	if (name) {
		entry.name = name;
	}

	if (Array.isArray(raw.channels)) {
		const channels = raw.channels
			.map((c) => text(c))
			.filter((c): c is string => c !== undefined)
			.slice(0, userTrackerLimits.channels);

		if (channels.length > 0) {
			entry.channels = channels;
		}
	}

	const profileUrl = text(raw.profileUrl, userTrackerLimits.url);

	if (isUsableProfileUrl(profileUrl)) {
		entry.profileUrl = profileUrl;

		const userHost = text(raw.userHost);

		if (userHost) {
			entry.userHost = userHost;
		}
	}

	if (raw.hidden === true) {
		entry.hidden = true;
	}

	return entry;
}

/**
 * Reads the stored `userTrackers` setting. Malformed entries are skipped, and
 * a value that can't be read at all counts as no entries.
 */
export function parseUserTrackers(stored: unknown): UserTracker[] {
	if (typeof stored !== "string" || stored === "") {
		return [];
	}

	let list: unknown;

	try {
		list = JSON.parse(stored);
	} catch {
		return [];
	}

	if (!Array.isArray(list)) {
		return [];
	}

	const result: UserTracker[] = [];
	const seen = new Set<string>();

	for (const value of list.slice(0, userTrackerLimits.entries)) {
		const entry = parseUserTracker(value);
		const key = entry && `${entry.network}\n${entry.id.toLowerCase()}`;

		// The first of two entries for the same tracker wins
		if (entry && !seen.has(key!)) {
			seen.add(key!);
			result.push(entry);
		}
	}

	return result;
}

export function serializeUserTrackers(entries: UserTracker[]) {
	return entries.length > 0 ? JSON.stringify(entries.slice(0, userTrackerLimits.entries)) : "";
}
