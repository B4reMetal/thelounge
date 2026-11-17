import socket from "../socket";
import eventbus from "../eventbus";
import {store} from "../store";
import {showMessagesAround, showMessagesAfter, takePendingJump} from "../chan";

// Answer to a jump to a message that wasn't loaded: the stored messages around it
socket.on("messages:around", (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	// The user may have gone elsewhere since: the channel shows what it
	// showed before, not an old slice
	if (!channel || !takePendingJump(data.chan, data.time)) {
		return;
	}

	showMessagesAround(channel, data);

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
