import {PluginInputHandler} from "./index.js";

const commands = ["whois", "whowas"];

const input: PluginInputHandler = function (network, chan, cmd, args) {
	const {irc} = network;

	if (cmd === "whowas") {
		// Its reply can't be told apart from a WHOIS reply for the same nick
		// a tracker profile lookup may be waiting for: show that one, too
		if (args.length > 0) {
			this.userIdentLookup.shownWhoisRequested(network, args[0]);
		}

		irc.raw(`${cmd} ${args.join(" ")}`);
		return;
	}

	if (args.length > 0) {
		this.userIdentLookup.shownWhoisRequested(network, args[args.length - 1]);
	}

	if (args.length === 1) {
		// This queries server of the other user and not of the current user, which
		// does not know idle time.
		// See http://superuser.com/a/272069/208074.
		irc.raw("WHOIS", args[0], args[0]);
	} else {
		// Re-assembling the command parsed in client.js
		irc.raw(`${cmd} ${args.join(" ")}`);
	}
};

export default {
	commands,
	input,
};
