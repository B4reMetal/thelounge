import {expect} from "chai";
import {parser} from "../../../../client/js/helpers/shoutbox-bridge/parser.js";
import {matchers} from "../../../../client/js/helpers/shoutbox-bridge/matchers.js";
import {ChanType} from "../../../../shared/types/chan.js";
import {MessageType, type SharedMsg} from "../../../../shared/types/msg.js";
import type {TorrentSiteInfo} from "../../../../shared/types/network.js";

const site = (abbreviation: string, channels?: string[]): TorrentSiteInfo => ({
	abbreviation,
	name: abbreviation,
	domain: `${abbreviation.toLowerCase()}.example`,
	channels,
	profileUrl: `https://${abbreviation.toLowerCase()}.example/users/`,
});

const darkpeers = {torrentSites: [site("DP")]};
const upload = {torrentSites: [site("ULCX", ["#Announce", "#ULCX", "#Support"])]};
const otherNetwork = {torrentSites: undefined};

const channel = (name: string) => ({type: ChanType.CHANNEL, name});
const query = (name: string) => ({type: ChanType.QUERY, name});

const msg = (nick: string, text: string): SharedMsg => ({
	id: 1,
	type: MessageType.MESSAGE,
	time: new Date(),
	from: {nick, mode: ""},
	users: [],
	text,
});

describe("shoutbox bridge parser", function () {
	it("rewrites a bridge bot's message on its tracker's network", function () {
		const result = parser(msg("dp", "[admin] hello"), darkpeers, channel("#darkpeers"));

		expect(result.text).to.equal("hello");
		expect(result.from).to.include({nick: "admin", shoutbox: true, original_nick: "dp"});
	});

	it("leaves the same bot nick untouched on another network", function () {
		const original = msg("dp", "[admin] hello");

		expect(parser(original, otherNetwork, channel("#darkpeers"))).to.equal(original);
		expect(parser(original, upload, channel("#ulcx"))).to.equal(original);
	});

	it("honours the tracker's channel list, case-insensitively", function () {
		const original = msg("ulcx", "[admin]: hello");

		expect(parser(original, upload, channel("#ulcx")).from?.nick).to.equal("admin");
		expect(parser(original, upload, channel("#offtopic"))).to.equal(original);
	});

	it("still scopes trackers without a profile link", function () {
		const ant = {torrentSites: [{...site("ANT", ["#ant-shout"]), profileUrl: null}]};
		const original = msg("sauron", "\x030 [\x03\x032 SB\x03\x030 ] \x03(admin): hello");

		expect(parser(original, ant, channel("#ant-shout")).from?.nick).to.equal("admin");
		expect(parser(original, darkpeers, channel("#ant-shout"))).to.equal(original);
	});

	it("never rewrites private queries, scoped or not", function () {
		const scoped = msg("dp", "[admin] hello");
		const unscoped = msg("chatbot", "[admin] hello");

		expect(parser(scoped, darkpeers, query("dp"))).to.equal(scoped);
		expect(parser(unscoped, otherNetwork, query("chatbot"))).to.equal(unscoped);
		expect(parser(scoped, darkpeers, undefined)).to.equal(scoped);
	});

	it("keeps unscoped matchers working in any channel", function () {
		const result = parser(msg("chatbot", "[admin] hello"), otherNetwork, channel("#aither"));

		expect(result.from?.nick).to.equal("admin");
	});

	it("only references abbreviations that exist in the default torrentSites", async function () {
		const {default: config} = (await import("../../../../defaults/config.js")) as {
			default: {torrentSites: Array<{abbreviation: string; disabled?: boolean}>};
		};
		const known = new Set(
			config.torrentSites.filter((s) => !s.disabled).map((s) => s.abbreviation)
		);

		for (const m of matchers) {
			if (m.site) {
				expect(known.has(m.site), `${m.name} -> ${m.site}`).to.equal(true);
			}
		}
	});
});
