import {IrcEventHandler} from "../../client.js";
import log from "../../log.js";
import {
	MAX_GROUPS,
	MAX_USERS_PER_GROUP,
	isValidGroupName,
	isValidNick,
	normaliseGroups,
	sortGroups,
} from "../userGroups.js";

export default <IrcEventHandler>function (irc, network) {
	// Handle SPJOIN command from seedpool/enhanced capable servers
	// Format: :SeedServ SPJOIN #channel nickname :GroupName
	irc.on("unknown command", (command) => {
		if (command.command !== "SPJOIN") {
			return;
		}

		const channelName = command.params[0];
		const nickname = command.params[1];
		const groupName = command.params[2];

		if (!channelName || !nickname || !groupName) {
			log.warn("SPJOIN: Missing channel, nickname, or group");
			return;
		}

		if (!isValidNick(nickname) || !isValidGroupName(groupName)) {
			log.warn("SPJOIN: Invalid nickname or group name");
			return;
		}

		const chan = network.getChannel(channelName);

		if (!chan) {
			log.warn(`SPJOIN: Channel ${channelName} not found`);
			return;
		}

		// Groups normally come from SPGROUPS and are already normalised, but do
		// not rely on that here.
		const groups = normaliseGroups(chan.groups) ?? [];
		const lowerNick = nickname.toLowerCase();

		// Remove user from any existing group (in case of group change)
		for (const group of groups) {
			const userIndex = group.users.findIndex((u) => u.toLowerCase() === lowerNick);

			if (userIndex !== -1) {
				group.users.splice(userIndex, 1);
			}
		}

		// Find the target group or create it
		let targetGroup = groups.find((g) => g.name === groupName);

		if (!targetGroup) {
			if (groups.length >= MAX_GROUPS) {
				// normaliseGroups() returned copies, so chan.groups is untouched
				log.warn(`SPJOIN: Too many groups on ${channelName}, ignoring ${groupName}`);
				return;
			}

			// Go below the lowest existing position
			const lowestPosition = groups.reduce(
				(lowest, g) => Math.min(lowest, g.position - 1),
				groups.length > 0 ? Infinity : 0
			);
			targetGroup = {name: groupName, position: lowestPosition, users: []};
			groups.push(targetGroup);
		}

		// Add user to the group
		if (targetGroup.users.length < MAX_USERS_PER_GROUP) {
			targetGroup.users.push(nickname);
		}

		// Sort groups by position (highest first) before emitting
		chan.groups = sortGroups(groups);

		// Emit updated groups to client
		this.emit("channel:groups", {
			chan: chan.id,
			groups: chan.groups,
		});
	});
};
