import socket from "../socket";
import {store} from "../store";
import type {ClientChan, ClientNetwork} from "../types";
import {openInNewTab} from "./openInNewTab";
import {parseUserTrackers, type UserTracker} from "../../../shared/trackers";
import {
	resolveTrackerProfileUrl,
	trackerProfileNeedsUser,
	withUserTrackers,
} from "./trackerProfile";

type Waiting = {
	network: ClientNetwork;
	channel: ClientChan;
	nick: string;
	tab: Window | null;
	timer: ReturnType<typeof setTimeout>;
};

// The user's own trackers, read again only when the setting changes
let parsedFrom: unknown = null;
let parsed: UserTracker[] = [];

function userTrackers() {
	const stored = store.state.settings.userTrackers;

	if (stored !== parsedFrom) {
		parsedFrom = stored;
		parsed = parseUserTrackers(stored);
	}

	return parsed;
}

/**
 * The trackers profile links on this network are built from: the server's,
 * with the user's own from their settings over them. Only for profile links;
 * see withUserTrackers.
 */
const linkTrackers = (network: ClientNetwork) => withUserTrackers(network, userTrackers());

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

	const url = resolveTrackerProfileUrl(
		linkTrackers(lookup.network),
		lookup.channel,
		lookup.nick,
		user
	);

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
	const trackers = linkTrackers(network);

	return (
		trackerProfileNeedsUser(trackers, channel, trackerId) ||
		resolveTrackerProfileUrl(trackers, channel, nick, undefined, trackerId) !== null
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
	const trackers = linkTrackers(network);

	if (!trackerProfileNeedsUser(trackers, channel, trackerId)) {
		const url = resolveTrackerProfileUrl(trackers, channel, nick, undefined, trackerId);

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
