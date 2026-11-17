import {expect} from "chai";
import {parser} from "../../../../client/js/helpers/shoutbox-bridge/parser.js";
import {matchers} from "../../../../client/js/helpers/shoutbox-bridge/matchers.js";
import {ChanType} from "../../../../shared/types/chan.js";
import {MessageType, type SharedMsg} from "../../../../shared/types/msg.js";
import type {TrackerInfo} from "../../../../shared/types/network.js";

const site = (id: string, channels?: string[]): TrackerInfo => ({
	id,
	name: id,
	channels,
	profileUrl: `https://${id.toLowerCase()}.example/users/{nick}`,
});

const darkpeers = {trackers: [site("DP")]};
const upload = {trackers: [site("ULCX", ["#Announce", "#ULCX", "#Support"])]};
const otherNetwork = {trackers: undefined};

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
		const ant = {trackers: [{id: "ANT", name: "Anthelion", channels: ["#ant-shout"]}]};
		const original = msg("sauron", "\x030 [\x03\x032 SB\x03\x030 ] \x03(admin): hello");

		expect(parser(original, ant, channel("#ant-shout")).from?.nick).to.equal("admin");
		expect(parser(original, darkpeers, channel("#ant-shout"))).to.equal(original);
	});

	it("never rewrites private queries, scoped or not", function () {
		const scoped = msg("dp", "[admin] hello");
		const unscoped = msg("willie", "\x0309[SB]\x03 admin: hello");

		expect(parser(scoped, darkpeers, query("dp"))).to.equal(scoped);
		expect(parser(unscoped, otherNetwork, query("willie"))).to.equal(unscoped);
		expect(parser(scoped, darkpeers, undefined)).to.equal(scoped);
	});

	it("keeps unscoped matchers working in any channel", function () {
		const result = parser(
			msg("willie", "\x0309[SB]\x03 admin: hello"),
			otherNetwork,
			channel("#beyondhd")
		);

		expect(result.from?.nick).to.equal("admin");
	});

	it("says which tracker a bridged user is from, when the matcher is scoped", function () {
		const scoped = parser(msg("dp", "[admin] hello"), darkpeers, channel("#darkpeers"));
		const unscoped = parser(
			msg("willie", "\x0309[SB]\x03 admin: hello"),
			otherNetwork,
			channel("#beyondhd")
		);

		expect(scoped.from?.tracker).to.equal("DP");
		expect(unscoped.from?.tracker).to.equal(undefined);
	});

	it("rewrites Aither's bridge bot on Aither's network only", function () {
		const aither = {trackers: [site("ATH")]};
		const message = msg("chatbot", "[admin] hello");

		expect(parser(message, aither, channel("#General")).from).to.include({
			nick: "admin",
			tracker: "ATH",
		});
		expect(parser(message, otherNetwork, channel("#General"))).to.equal(message);
	});

	it("leaves disabled matchers out, on every network", function () {
		for (const [nick, text] of [
			["dreadvaultbot", "[admin] hello"],
			["admin-web", "hello"],
		]) {
			const message = msg(nick, text);

			expect(parser(message, otherNetwork, channel("#any"))).to.equal(message);
			expect(parser(message, darkpeers, channel("#darkpeers"))).to.equal(message);
		}

		expect(matchers.filter((m) => m.disabled).map((m) => m.name)).to.deep.equal([
			"DreadVault",
			"HUNO (Web)",
		]);
	});

	it("only references trackers that exist in the default config", async function () {
		const {default: config} = (await import("../../../../defaults/config.js")) as {
			default: {trackers: Record<string, {disabled?: boolean}>};
		};

		for (const m of matchers) {
			if (m.tracker) {
				expect(config.trackers[m.tracker], `${m.name} -> ${m.tracker}`).to.be.an("object");
				expect(config.trackers[m.tracker].disabled).to.not.equal(true);
			}
		}
	});
});
