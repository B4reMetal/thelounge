import type {ClientChan, ClientNetwork} from "../types";
import {ChanType} from "../../../shared/types/chan";
import type {TrackerInfo} from "../../../shared/types/network";
import {
	isUsableProfileUrl,
	trackerIdentPlaceholder,
	trackerNickPlaceholder,
	type UserTracker,
} from "../../../shared/trackers";

type Network = Pick<ClientNetwork, "trackers">;
type Channel = Pick<ClientChan, "type" | "name"> | undefined;

/**
 * Whether a tracker on this network (see `trackers` in config.js) applies in
 * `channel`. A tracker with a channel list only applies in those channels;
 * one without applies everywhere on the network.
 */
export function trackerAppliesTo(tracker: Pick<TrackerInfo, "channels">, channel: Channel) {
	if (!tracker.channels || tracker.channels.length === 0) {
		return true;
	}

	if (channel?.type !== ChanType.CHANNEL) {
		return false;
	}

	const channelName = channel.name.toLowerCase();
	return tracker.channels.some((c) => c.toLowerCase() === channelName);
}

/**
 * The tracker with this id (case-insensitive), if it is on this network and
 * applies in `channel`.
 */
export function findTracker(network: Network, channel: Channel, id: string) {
	const wanted = id.toLowerCase();

	return network.trackers?.find(
		(t) => t.id.toLowerCase() === wanted && trackerAppliesTo(t, channel)
	);
}

/**
 * The trackers to build profile links from on this network: the server's
 * (config.js) with the user's own entries from their settings over them.
 *
 * A user entry with the id of one of the server's trackers replaces its
 * profile address and users' hostname, or hides its link; any other entry for
 * this network's key (`trackerKey`, which stands for its IRC server host) is
 * added, ahead of the server's. Entries with a key of no network are ignored. Name and channels of
 * the server's trackers stay as they are.
 *
 * This is for profile links only. Shoutbox bridge matchers must keep looking
 * at `network.trackers` (see findTracker), which this leaves untouched: what a
 * user writes in their settings must not decide whose messages get rewritten.
 */
export function withUserTrackers(
	network: Pick<ClientNetwork, "trackers"> & {trackerKey?: string},
	userTrackers: UserTracker[]
): Network {
	const key = network.trackerKey?.toLowerCase();
	const own = key ? userTrackers.filter((t) => t.network.toLowerCase() === key) : [];

	if (own.length === 0) {
		return {trackers: network.trackers};
	}

	const serverTrackers = network.trackers ?? [];
	const ownFor = (id: string) => own.find((t) => t.id.toLowerCase() === id.toLowerCase());
	const merged: TrackerInfo[] = [];

	for (const entry of own) {
		const isServers = serverTrackers.some((t) => t.id.toLowerCase() === entry.id.toLowerCase());

		// Settings can be written by older clients or by hand: check again
		if (!isServers && !entry.hidden && isUsableProfileUrl(entry.profileUrl)) {
			merged.push({
				id: entry.id,
				name: entry.name ?? entry.id,
				channels: entry.channels,
				profileUrl: entry.profileUrl,
				userHost: entry.userHost,
			});
		}
	}

	for (const tracker of serverTrackers) {
		const entry = ownFor(tracker.id);

		if (!entry) {
			merged.push(tracker);
		} else if (entry.hidden) {
			merged.push({...tracker, profileUrl: undefined, userHost: undefined});
		} else if (isUsableProfileUrl(entry.profileUrl)) {
			merged.push({...tracker, profileUrl: entry.profileUrl, userHost: entry.userHost});
		} else {
			merged.push(tracker);
		}
	}

	return {trackers: merged};
}

// Whether the tracker's profile address is built from the ident, which
// has to be asked from the server first
const needsIdent = (tracker: TrackerInfo) =>
	Boolean(tracker.profileUrl?.includes(trackerIdentPlaceholder));

// Outside of its channels, a tracker that shares its network with others can
// still be told by the hostname of its users
const mayApply = (tracker: TrackerInfo, channel: Channel) =>
	trackerAppliesTo(tracker, channel) ||
	(channel?.type !== ChanType.CHANNEL && needsIdent(tracker) && Boolean(tracker.userHost));

/**
 * The trackers `nick`'s profile could be on, in the order they are tried.
 *
 * With `trackerId` only that tracker is considered: a message relayed from a
 * tracker's shoutbox was written by a user of that tracker and no other.
 */
export function profileTrackers(network: Network, channel: Channel, trackerId?: string) {
	if (trackerId) {
		const tracker = findTracker(network, channel, trackerId);
		return tracker?.profileUrl ? [tracker] : [];
	}

	return (network.trackers ?? []).filter((t) => t.profileUrl && mayApply(t, channel));
}

/**
 * Whether finding `nick`'s profile takes asking the server who they are
 * (see resolveTrackerProfileUrl). A bridged user has no ident of their own,
 * the bridge bot's says nothing about them.
 */
export function trackerProfileNeedsUser(network: Network, channel: Channel, trackerId?: string) {
	return !trackerId && profileTrackers(network, channel).some(needsIdent);
}

function matchesUserHost(pattern: string | undefined, hostname: string) {
	if (!pattern) {
		return true;
	}

	const regex = pattern
		.split("*")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");

	return new RegExp(`^${regex}$`, "i").test(hostname);
}

const fill = (template: string, values: {nick: string; ident?: string}) =>
	template
		.replaceAll(trackerNickPlaceholder, encodeURIComponent(values.nick))
		.replaceAll(trackerIdentPlaceholder, encodeURIComponent(values.ident ?? ""));

/**
 * Address of `nick`'s profile on a tracker of this network, or null.
 *
 * `user` is what the server knows about them, for trackers whose address is
 * built from the ident. There the ident has to be a number, as user ids are,
 * and the hostname has to look like one of the tracker's users where the
 * tracker says what that looks like. Without `user` such trackers are skipped.
 */
export function resolveTrackerProfileUrl(
	network: Network,
	channel: Channel,
	nick: string,
	user?: {ident?: string; hostname?: string},
	trackerId?: string
): string | null {
	if (!nick) {
		return null;
	}

	for (const tracker of profileTrackers(network, channel, trackerId)) {
		if (!needsIdent(tracker)) {
			return fill(tracker.profileUrl!, {nick});
		}

		if (
			!trackerId &&
			user?.ident &&
			/^\d+$/.test(user.ident) &&
			matchesUserHost(tracker.userHost, user.hostname ?? "")
		) {
			return fill(tracker.profileUrl!, {nick, ident: user.ident});
		}
	}

	return null;
}

/**
 * Address of `nick`'s profile from what the client knows by itself, or null.
 * See resolveTrackerProfileUrl.
 */
export function getTrackerProfileUrl(
	network: Network,
	channel: Channel,
	nick: string,
	trackerId?: string
): string | null {
	return resolveTrackerProfileUrl(network, channel, nick, undefined, trackerId);
}
