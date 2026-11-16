import {IrcEventHandler} from "../../client.js";
import log from "../../log.js";
import {normaliseGroups} from "../userGroups.js";

export default <IrcEventHandler>function (irc, network) {
	// Handle SPGROUPS command from seedpool/enhanced capable servers
	// Format: :SeedServ SPGROUPS #channel :{"groups":[{"name":"Sysop","users":["admin1"]}, ...]}
	irc.on("unknown command", (command) => {
		if (command.command !== "SPGROUPS") {
			return;
		}

		const channelName = command.params[0];
		const jsonPayload = command.params[1];

		if (!channelName || !jsonPayload) {
			log.warn("SPGROUPS: Missing channel or payload");
			return;
		}

		const chan = network.getChannel(channelName);

		if (!chan) {
			log.warn(`SPGROUPS: Channel ${channelName} not found`);
			return;
		}

		let data: unknown;

		try {
			data = JSON.parse(jsonPayload);
		} catch (err) {
			log.error(`SPGROUPS: Failed to parse JSON payload: ${String(err)}`);
			return;
		}

		const groups =
			data && typeof data === "object"
				? normaliseGroups((data as {groups?: unknown}).groups)
				: null;

		if (!groups) {
			log.warn("SPGROUPS: Invalid payload format, expected {groups: [...]}");
			return;
		}

		// Store only well-formed groups on the channel, sorted by position (highest first)
		chan.groups = groups;

		// Emit to client
		this.emit("channel:groups", {
			chan: chan.id,
			groups: chan.groups,
		});
	});
};
