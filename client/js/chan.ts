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

// Ids restart with the server on old data, id and time together don't repeat
function messageKey(message: SharedMsg): string {
	return `${message.id}:${new Date(message.time).getTime()}`;
}

function appendMessages(channel: ClientChan, incoming: SharedMsg[]): number {
	const known = new Set(channel.messages.map(messageKey));
	const fresh = markMsgsRaw(incoming.filter((m) => !known.has(messageKey(m))));
	const chunkSize = 10000;

	for (let start = 0; start < fresh.length; start += chunkSize) {
		channel.messages.push(...fresh.slice(start, start + chunkSize));
	}

	return fresh.length;
}

// How many live messages a history slice holds on to before giving up and
// leaving them to be read back from storage
const maxBufferedLive = 500;

/**
 * Puts the stored messages around some point in time on screen, for jumping to
 * a message that isn't loaded.
 *
 * If they connect to what is already loaded they are simply added to it.
 * Otherwise they replace it and the channel becomes a history slice: a window
 * into the past that can be extended in both directions, and that live
 * messages stay out of until it has been extended all the way to the present.
 */
export function showMessagesAround(
	channel: ClientChan,
	data: {messages: SharedMsg[]; hasMoreBefore: boolean; hasMoreAfter: boolean}
): void {
	if (data.messages.length === 0) {
		return;
	}

	const loaded = new Set(channel.messages.map(messageKey));
	const connects = data.messages.some((m) => loaded.has(messageKey(m)));

	if (connects && !channel.historySlice) {
		// The target was older than everything loaded, so whatever is new
		// here sits directly in front of it
		prependMessages(channel, data.messages);
	} else if (!data.hasMoreAfter) {
		// Reaches the newest stored message: this is the present, keep
		// anything newer that is only in memory
		const fetched = new Set(data.messages.map(messageKey));
		const newer = (channel.historySlice?.live || channel.messages).filter(
			(m) => !fetched.has(messageKey(m))
		);

		channel.messages = markMsgsRaw(data.messages).concat(newer);
		channel.historySlice = undefined;
	} else {
		channel.messages = markMsgsRaw(data.messages);
		channel.historySlice = {hasNewer: true, loadingNewer: false, live: [], liveDropped: false};
	}

	channel.moreHistoryAvailable = data.hasMoreBefore;
}

/**
 * Extends a history slice towards the present with the next page from storage.
 * Once storage has nothing newer, the live messages collected meanwhile are
 * added and the channel is a normal, live one again.
 */
export function showMessagesAfter(
	channel: ClientChan,
	data: {messages: SharedMsg[]; hasMore: boolean}
): void {
	const slice = channel.historySlice;

	if (!slice) {
		return;
	}

	slice.loadingNewer = false;
	const added = appendMessages(channel, data.messages);

	if (data.hasMore) {
		// Nothing new in a full page would mean asking for it again forever
		slice.hasNewer = added > 0;
		return;
	}

	if (slice.liveDropped) {
		// Live messages were dropped since this page was requested, they are
		// in storage by now: ask again
		return;
	}

	appendMessages(channel, slice.live);
	channel.historySlice = undefined;
}

/**
 * Takes a message that arrived live. Returns false when the channel is showing
 * a history slice, in which case the message is held back instead of shown.
 */
export function receiveLiveMessage(channel: ClientChan, message: SharedMsg): boolean {
	const slice = channel.historySlice;

	if (!slice) {
		channel.messages.push(markMsgRaw(message));
		return true;
	}

	slice.live.push(markMsgRaw(message));

	if (slice.live.length > maxBufferedLive) {
		slice.live = [];
		slice.liveDropped = true;
		slice.hasNewer = true;
	}

	return false;
}

/**
 * Drops a history slice. The channel is left empty and has to be filled with
 * the latest messages again by asking the server for them.
 */
export function leaveHistorySlice(channel: ClientChan): void {
	if (!channel.historySlice) {
		return;
	}

	channel.historySlice = undefined;
	channel.messages = [];
	channel.moreHistoryAvailable = true;
}

/**
 * Drops the oldest messages beyond `limit`. They are paged back in from the
 * server when scrolled to, and a jump fetches the history around any message,
 * so there is no reason to hold more than what is likely to be looked at.
 *
 * A history slice is never trimmed: its messages are a window into the past
 * that the user is reading, not the newest part of the channel.
 */
export function trimMessages(channel: ClientChan, limit: number): void {
	if (channel.historySlice || limit <= 0 || channel.messages.length <= limit) {
		return;
	}

	channel.messages.splice(0, channel.messages.length - limit);
	channel.moreHistoryAvailable = true;
}

/**
 * How many messages a channel keeps once a live message arrived in it, 0 for
 * no limit.
 */
export function liveMessageLimit(channel: ClientChan, isActiveChannel: boolean): number {
	if (!isActiveChannel) {
		// Nobody is looking at it, keep about what opening it shows
		return 100;
	}

	if (channel.scrolledToBottom) {
		// One history page holds up to 1000 messages when status messages
		// are condensed or hidden
		return 1500;
	}

	// The user is reading older messages (possibly a message jumped to),
	// leave them alone
	return 0;
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
