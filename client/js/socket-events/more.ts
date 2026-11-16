import {nextTick} from "vue";

import socket from "../socket";
import {store} from "../store";
import {prependMessages} from "../chan";
import {MessageType} from "../../../shared/types/msg";

socket.on("more", async (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	channel.inputHistory = channel.inputHistory.concat(
		data.messages
			.filter((m) => m.self && m.text && m.type === MessageType.MESSAGE)
			// TS is too stupid to see the guard in .filter(), so we monkey patch it
			// to please the compiler
			.map((m) => (m.text ? m.text : ""))
			.reverse()
			.slice(0, 100 - channel.inputHistory.length)
	);
	const newest = data.messages[data.messages.length - 1];

	if (
		channel.historySlice &&
		newest &&
		channel.messages.length > 0 &&
		new Date(newest.time).getTime() > new Date(channel.messages[0].time).getTime()
	) {
		// Asked for before the channel jumped into the past: this page is
		// newer than the slice now shown and doesn't belong in front of it
		channel.historyLoading = false;
		return;
	}

	channel.moreHistoryAvailable = data.hasMore;
	prependMessages(channel, data.messages);

	await nextTick();
	channel.historyLoading = false;
});
