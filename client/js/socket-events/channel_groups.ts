import socket from "../socket";
import {store} from "../store";

// Handle channel groups from seedpool/enhanced capable servers
socket.on("channel:groups", (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	if (!Array.isArray(data.groups)) {
		return;
	}

	// Create a new array to ensure Vue reactivity detects the change. The server
	// already validates groups; skip anything malformed regardless so the user
	// list and context menu never trip over it.
	channel.groups = data.groups.filter(
		(g) =>
			g &&
			typeof g.name === "string" &&
			typeof g.position === "number" &&
			Array.isArray(g.users) &&
			g.users.every((u) => typeof u === "string")
	);
});
