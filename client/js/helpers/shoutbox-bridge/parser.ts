import type { SharedMsg } from "../../../../shared/types/msg";
import { ChanType } from "../../../../shared/types/chan";
import type { ClientChan, ClientNetwork } from "../../types";
import { toRaw } from "vue";
import { findTracker } from "../trackerProfile";
import { matchers } from "./matchers";
import { type Matcher } from "./types/matcher";

/**
 * Parse message aganst `Matchers` and edit the Nick and Content based on `transform` results.
 * Only messages in channels are considered, and matchers with a `tracker` only
 * apply on the network/channels configured for that tracker in `trackers`.
 */
export function parser (
	originalMessage: SharedMsg,
	network: Pick<ClientNetwork, "trackers">,
	channel: Pick<ClientChan, "type" | "name"> | undefined
) {
	const originalSender = originalMessage.from?.nick?.toLowerCase();

	if (!originalMessage.text || !originalSender) return originalMessage;

	// Bridge bots post in channels; a private query is never a bridged message
	if (channel?.type !== ChanType.CHANNEL) return originalMessage;

	const matcher = matchers.find(m => {
		if (!inScope(m, network, channel)) return false;
		if (m.type === "basic") return m.matches.includes(originalSender);
		if (m.type === "advanced") return m.matches(originalSender);
		return false;
	});
	if (!matcher) return originalMessage;

	const edit = matcher.transform(originalMessage);
	if (!edit || !edit.nick) return originalMessage;

	// Shallow copy: only `text` and `from` are replaced below, and `previews`
	// has to stay the same reactive array the store updates
	const message = {...toRaw(originalMessage)};
	message.text = edit.content ?? message.text;
	message.from = {
		...message.from!,
		nick: sanitizeNick(edit.nick),
		mode: "",
		shoutbox: true,
		original_nick: originalSender,
		// Whose user this is, so their profile can be linked
		tracker: matcher.tracker
	};

	return message;
}

/**
 * Whether `matcher` may run on this network/channel. Unscoped matchers (no
 * `tracker`) always may; scoped ones need their tracker in `network.trackers`.
 */
function inScope (
	matcher: Matcher,
	network: Pick<ClientNetwork, "trackers">,
	channel: Pick<ClientChan, "type" | "name">
) {
	return !matcher.tracker || findTracker(network, channel, matcher.tracker) !== undefined;
}

/**
 * Helper to remove invalid chars from nick string
 */
function sanitizeNick (nick: string) {
	return nick.replaceAll(/[^0-9a-z_-|]/gi, "");
}
