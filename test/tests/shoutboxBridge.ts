import {expect} from "chai";

import {parser} from "../../client/js/helpers/shoutbox-bridge/parser.js";
import type {SharedMsg} from "../../shared/types/msg";

// "chatbot" is relayed with the "[nick] message" format
const bridged = (nick: string) =>
	parser({
		from: {nick: "chatbot", mode: ""},
		text: `[${nick}] hello`,
	} as unknown as SharedMsg);

describe("shoutbox bridge parser", function () {
	it("keeps hyphens and the other IRC nick characters", function () {
		expect(bridged("foo-bar").from?.nick).to.equal("foo-bar");
		expect(bridged("a_b|c{d}e^f`g\\h").from?.nick).to.equal("a_b|c{d}e^f`g\\h");
	});

	it("keeps non-ASCII letters and digits", function () {
		expect(bridged("José42").from?.nick).to.equal("José42");
	});

	it("strips characters that are not valid in a nick", function () {
		expect(bridged("John Doe!").from?.nick).to.equal("JohnDoe");
		expect(bridged("a.b,c~d@e").from?.nick).to.equal("abcde");
	});

	it("keeps the relay nick as original_nick and rewrites the text", function () {
		const msg = bridged("foo-bar");
		expect(msg.from?.original_nick).to.equal("chatbot");
		expect(msg.from?.shoutbox).to.equal(true);
		expect(msg.text).to.equal("hello");
	});
});
