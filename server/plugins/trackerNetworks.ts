import crypto from "node:crypto";
import Config from "../config.js";
import type Network from "../models/network.js";
import {parseUserTrackers, trackerIdentPlaceholder} from "../../shared/trackers.js";

// Fixed label, so the key is derived from the secret for this use only
const label = "thelounge tracker network key v1";

// Until a persisted secret is given (see setTrackerKeySecret), keys are only
// stable for this process. That is enough for public mode, which keeps no
// settings.
let secret: crypto.BinaryLike = crypto.randomBytes(32);

/**
 * Sets the persisted secret network keys are derived from (the web push
 * VAPID private key, which lives in the data folder).
 */
export function setTrackerKeySecret(persisted: string) {
	secret = crypto.createHmac("sha256", persisted).update(label).digest();
}

/**
 * Key that stands for an IRC server host in the trackers users add in their
 * settings. The client gets this instead of the host, which it isn't told
 * (with lockNetwork it is meant to stay hidden). The same host always gives
 * the same key, on every device, but the host can't be told from the key
 * without the server's secret.
 */
export function trackerNetworkKey(host: string) {
	return crypto
		.createHmac("sha256", secret)
		.update(host.toLowerCase())
		.digest("hex")
		.slice(0, 32);
}

/**
 * Whether a tracker for this IRC server builds its profile address from the
 * ident, so asking the server who a user is (`tracker:user`) is of use. That
 * is a tracker from config.js, or one in the user's own synced settings.
 */
export function networkNeedsIdentLookup(host: string, clientSettings: unknown) {
	const needsIdent = (t: {profileUrl?: string}) =>
		Boolean(t.profileUrl?.includes(trackerIdentPlaceholder));

	if (Config.getTrackersForHost(host)?.some(needsIdent)) {
		return true;
	}

	const stored =
		typeof clientSettings === "object" && clientSettings !== null
			? (clientSettings as Record<string, unknown>).userTrackers
			: undefined;
	const key = trackerNetworkKey(host);

	return parseUserTrackers(stored).some((t) => t.network === key && !t.hidden && needsIdent(t));
}

/**
 * Answer to a client's `tracker:user` request: the ident and hostname of
 * `nick` on `network`, looked up (perhaps with a WHOIS) only where a tracker
 * needs them (see networkNeedsIdentLookup). Elsewhere it is null right away.
 */
export function trackerUserLookup<T>(
	identLookup: {lookup(network: Network, nick: string): Promise<T | null>},
	network: Network | undefined,
	nick: string,
	clientSettings: unknown
): Promise<T | null> {
	return network && networkNeedsIdentLookup(network.host, clientSettings)
		? identLookup.lookup(network, nick)
		: Promise.resolve(null);
}
