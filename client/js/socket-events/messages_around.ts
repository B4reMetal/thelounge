import socket from "../socket";
import eventbus from "../eventbus";
import {store} from "../store";
import {showMessagesAround, showMessagesAfter} from "../chan";

// Answer to a jump to a message that wasn't loaded: the stored messages around it
socket.on("messages:around", (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	showMessagesAround(channel, data);
	channel.historyLoading = false;

	// The message list scrolls to the message it was looking for
	eventbus.emit("messages:around", data.chan);
});

// Next page towards the present for a channel showing a history slice
socket.on("messages:after", (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (channel) {
		showMessagesAfter(channel, data);
	}
});
