import socket from "../socket";
import {store} from "../store";
import type {ClientChan, ClientNetwork} from "../types";
import {openInNewTab} from "./openInNewTab";
import {resolveTrackerProfileUrl, trackerProfileNeedsUser} from "./trackerProfile";

type Waiting = {
	network: ClientNetwork;
	channel: ClientChan;
	nick: string;
	tab: Window | null;
	timer: ReturnType<typeof setTimeout>;
};

// Lookups the server has yet to answer, by channel id and nick
const waiting = new Map<string, Waiting>();
const key = (target: number, nick: string) => `${target}:${nick.toLowerCase()}`;

function finish(id: string, user?: {ident?: string; hostname?: string}) {
	const lookup = waiting.get(id);

	if (!lookup) {
		return;
	}

	clearTimeout(lookup.timer);
	waiting.delete(id);

	const url = resolveTrackerProfileUrl(lookup.network, lookup.channel, lookup.nick, user);

	if (!url) {
		lookup.tab?.close();
		store.commit(
			"currentUserVisibleError",
			`Could not find a tracker profile for ${lookup.nick}.`
		);
		setTimeout(() => store.commit("currentUserVisibleError", null), 4000);
		return;
	}

	if (lookup.tab && !lookup.tab.closed) {
		lookup.tab.location.replace(url);
	} else {
		openInNewTab(url);
	}
}

socket.on("tracker:user", (data) => {
	finish(key(data.target, data.nick), data);
});

/**
 * Whether there is a tracker `nick`'s profile could be on. For some trackers
 * that is only known for sure once the server has been asked who they are.
 */
export function hasTrackerProfile(
	network: ClientNetwork,
	channel: ClientChan,
	nick: string,
	trackerId?: string
) {
	return (
		trackerProfileNeedsUser(network, channel, trackerId) ||
		resolveTrackerProfileUrl(network, channel, nick, undefined, trackerId) !== null
	);
}

/**
 * Opens `nick`'s tracker profile in a new tab, asking the server who they are
 * first where the tracker's address is built from that.
 */
export function openTrackerProfile(
	network: ClientNetwork,
	channel: ClientChan,
	nick: string,
	trackerId?: string
) {
	if (!trackerProfileNeedsUser(network, channel, trackerId)) {
		const url = resolveTrackerProfileUrl(network, channel, nick, undefined, trackerId);

		if (url) {
			openInNewTab(url);
		}

		return;
	}

	const id = key(channel.id, nick);

	if (waiting.has(id)) {
		return;
	}

	// Opened now, while this still counts as the user's click: a tab opened
	// when the answer arrives would be stopped as a pop-up
	const tab = window.open("about:blank", "_blank");

	if (tab) {
		tab.opener = null;
	}

	waiting.set(id, {
		network,
		channel,
		nick,
		tab,
		timer: setTimeout(() => finish(id), 8000),
	});

	socket.emit("tracker:user", {target: channel.id, nick});
}
