import {markRaw, reactive} from "vue";
import {ClientChan, ClientMessage} from "./types";
import {SharedNetworkChan} from "../../shared/types/network";
import {SharedMsg, MessageType} from "../../shared/types/msg";
import {ChanType} from "../../shared/types/chan";

/**
 * Opts a message out of Vue's deep reactivity. Call this on every message
 * before it is put into a channel's `messages` array.
 *
 * Messages do not change once created, yet a reactive message costs a proxy
 * plus dependency tracking for every field any computed reads, which adds up
 * to ~1 KB and a slower list rebuild per loaded message. The one part that is
 * mutated in place is `previews` (shown/hidden state, late arriving link
 * previews), so that array is kept reactive explicitly.
 */
export function markMsgRaw<T extends SharedMsg>(msg: T): T {
	if (msg.previews) {
		msg.previews = reactive(msg.previews);
	}

	return markRaw(msg);
}

export function markMsgsRaw<T extends SharedMsg>(msgs: T[]): T[] {
	for (const msg of msgs) {
		markMsgRaw(msg);
	}

	return msgs;
}

/**
 * Prepends messages the channel doesn't hold yet, ignoring the rest.
 *
 * History can reach the client twice (a page it asked for and the page the
 * server sends when it first reads a channel from storage), so everything is
 * matched by id. Prepending happens in slices because `unshift(...items)`
 * throws once `items` is larger than the engine's argument limit, which is
 * as low as 65k in some browsers.
 */
export function prependMessages(channel: ClientChan, incoming: SharedMsg[]): number {
	const known = new Set<number>();

	for (const message of channel.messages) {
		known.add(message.id);
	}

	const fresh = markMsgsRaw(incoming.filter((m) => !known.has(m.id)));
	const chunkSize = 10000;

	for (let end = fresh.length; end > 0; end -= chunkSize) {
		channel.messages.unshift(...fresh.slice(Math.max(0, end - chunkSize), end));
	}

	return fresh.length;
}

export function toClientChan(shared: SharedNetworkChan): ClientChan {
	const history: string[] = [""].concat(
		shared.messages
			.filter((m) => m.self && m.text && m.type === MessageType.MESSAGE)
			// TS is too stupid to see the nil guard on filter... so we monkey patch it
			.map((m): string => (m.text ? m.text : ""))
			.reverse()
			.slice(0, 99)
	);
	// filter the unused vars
	const {messages, ...props} = shared;
	const channel: ClientChan = {
		...props,
		editTopic: false,
		pendingMessage: "",
		inputHistoryPosition: 0,
		historyLoading: false,
		scrolledToBottom: true,
		users: [],
		usersOutdated: shared.type === ChanType.CHANNEL ? true : false,
		// The server reads stored history when a channel is first opened.
		// Until then it can't tell how much there is, so assume there is more.
		moreHistoryAvailable:
			!shared.historyLoaded || shared.totalMessages > shared.messages.length,
		inputHistory: history,
		messages: sharedMsgToClientMsg(messages),
		// Initialize groups for reactivity (will be populated by SPGROUPS)
		groups: shared.groups || undefined,
	};
	return channel;
}

function sharedMsgToClientMsg(shared: SharedMsg[]): ClientMessage[] {
	// TODO: this is a stub for now, we will want to populate client specific stuff here
	return markMsgsRaw(shared);
}
