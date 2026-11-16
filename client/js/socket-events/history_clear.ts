import socket from "../socket";
import {store} from "../store";

socket.on("history:clear", function (data) {
	const netChan = store.getters.findChannel(data.target);

	if (netChan?.channel) {
		netChan.channel.messages = [];
		netChan.channel.historySlice = undefined;
		netChan.channel.unread = 0;
		netChan.channel.highlight = 0;
		netChan.channel.firstUnread = 0;
		netChan.channel.moreHistoryAvailable = false;
	}
});
