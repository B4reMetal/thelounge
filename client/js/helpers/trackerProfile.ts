import type {ClientChan, ClientNetwork} from "../types";
import {ChanType} from "../../../shared/types/chan";

/**
 * Profile URL on the tracker configured for this network (see `torrentSites`
 * in config.js), or null. In a channel, only sites that list that channel (or
 * list no channels) match; elsewhere, only sites without a channel list do.
 */
export function getTrackerProfileUrl(
	network: Pick<ClientNetwork, "torrentSites">,
	channel: Pick<ClientChan, "type" | "name"> | undefined,
	nick: string
): string | null {
	if (!network.torrentSites || !nick) {
		return null;
	}

	const inChannel = channel?.type === ChanType.CHANNEL;
	const channelName = channel?.name.toLowerCase();

	const site = network.torrentSites.find((s) => {
		if (!s.channels || s.channels.length === 0) {
			return true;
		}

		return inChannel && s.channels.some((c) => c.toLowerCase() === channelName);
	});

	return site ? site.profileUrl + encodeURIComponent(nick) : null;
}
