import type {ClientChan, ClientNetwork} from "../types";
import {ChanType} from "../../../shared/types/chan";
import type {TorrentSiteInfo} from "../../../shared/types/network";

/**
 * Whether a tracker configured for this network (see `torrentSites` in
 * config.js) applies in `channel`. Sites with a channel list only apply in
 * those channels; sites without one apply everywhere on the network.
 */
export function torrentSiteAppliesTo(
	site: Pick<TorrentSiteInfo, "channels">,
	channel: Pick<ClientChan, "type" | "name"> | undefined
): boolean {
	if (!site.channels || site.channels.length === 0) {
		return true;
	}

	if (channel?.type !== ChanType.CHANNEL) {
		return false;
	}

	const channelName = channel.name.toLowerCase();
	return site.channels.some((c) => c.toLowerCase() === channelName);
}

/**
 * Profile URL on the tracker configured for this network (see `torrentSites`
 * in config.js), or null. In a channel, only sites that list that channel (or
 * list no channels) match; elsewhere, only sites without a channel list do.
 * Sites with `profileLink: false` never match.
 */
export function getTrackerProfileUrl(
	network: Pick<ClientNetwork, "torrentSites">,
	channel: Pick<ClientChan, "type" | "name"> | undefined,
	nick: string
): string | null {
	if (!network.torrentSites || !nick) {
		return null;
	}

	const site = network.torrentSites.find((s) => s.profileUrl && torrentSiteAppliesTo(s, channel));

	return site?.profileUrl ? site.profileUrl + encodeURIComponent(nick) : null;
}
