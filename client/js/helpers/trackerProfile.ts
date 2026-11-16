import type {ClientChan, ClientNetwork} from "../types";
import {ChanType} from "../../../shared/types/chan";
import {type TrackerInfo, trackerNickPlaceholder} from "../../../shared/types/network";

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
 * Address of `nick`'s profile on a tracker of this network, or null.
 *
 * With `trackerId` only that tracker is considered: a message relayed from a
 * tracker's shoutbox was written by a user of that tracker and no other.
 * Otherwise it is the first tracker that applies in `channel` and has a
 * profile address.
 */
export function getTrackerProfileUrl(
	network: Network,
	channel: Channel,
	nick: string,
	trackerId?: string
): string | null {
	if (!network.trackers || !nick) {
		return null;
	}

	const tracker = trackerId
		? findTracker(network, channel, trackerId)
		: network.trackers.find((t) => t.profileUrl && trackerAppliesTo(t, channel));

	if (!tracker?.profileUrl) {
		return null;
	}

	return tracker.profileUrl.replaceAll(trackerNickPlaceholder, encodeURIComponent(nick));
}
