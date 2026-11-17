import {expect} from "chai";
import {
	resolveTrackerProfileUrl,
	trackerProfileNeedsUser,
	withUserTrackers,
} from "../../../../client/js/helpers/trackerProfile.js";
import {parser} from "../../../../client/js/helpers/shoutbox-bridge/parser.js";
import {ChanType} from "../../../../shared/types/chan.js";
import {MessageType, type SharedMsg} from "../../../../shared/types/msg.js";
import type {TrackerInfo} from "../../../../shared/types/network.js";
import {parseUserTrackers, type UserTracker} from "../../../../shared/trackers.js";

const channel = (name: string) => ({type: ChanType.CHANNEL, name});

const seedpool: TrackerInfo = {
	id: "SP",
	name: "Seedpool",
	channels: ["#seedpool"],
	profileUrl: "https://seedpool.org/users/{nick}",
};

// A network's trackerKey, as the server sends it
const host = "5f2b0c8e6a1d4f3b9c7e2a1d0b9c8e7f";
const network = (trackers?: TrackerInfo[]) => ({trackerKey: host, trackers});

const mine = (entry: Partial<UserTracker>): UserTracker => ({
	id: "user-1",
	network: host,
	name: "Mine",
	profileUrl: "https://mine.example/u/{nick}",
	...entry,
});

describe("withUserTrackers", function () {
	it("leaves the server's list alone without user entries", function () {
		const net = network([seedpool]);

		expect(withUserTrackers(net, []).trackers).to.equal(net.trackers);
	});

	it("ignores entries for another network, or a key of none", function () {
		const net = network([seedpool]);
		const merged = withUserTrackers(net, [
			mine({network: "0000000000000000000000000000000"}),
			// Stored by an earlier version, with a hostname
			mine({network: "irc.example.net"}),
		]);

		expect(merged.trackers).to.deep.equal([seedpool]);
	});

	it("ignores everything for a network without a key", function () {
		expect(withUserTrackers({trackers: undefined}, [mine({})]).trackers).to.equal(undefined);
	});

	it("matches the key case-insensitively", function () {
		const merged = withUserTrackers({trackerKey: host.toUpperCase()}, [mine({})]);

		expect(merged.trackers?.map((t) => t.id)).to.deep.equal(["user-1"]);
	});

	it("adds the user's trackers ahead of the server's", function () {
		const merged = withUserTrackers(network([seedpool]), [mine({})]);

		expect(merged.trackers?.map((t) => t.id)).to.deep.equal(["user-1", "SP"]);
		expect(resolveTrackerProfileUrl(merged, channel("#anywhere"), "alice")).to.equal(
			"https://mine.example/u/alice"
		);
	});

	it("adds trackers on networks the server has none for", function () {
		const merged = withUserTrackers(network(undefined), [mine({channels: ["#mine"]})]);

		expect(resolveTrackerProfileUrl(merged, channel("#Mine"), "bob")).to.equal(
			"https://mine.example/u/bob"
		);
		expect(resolveTrackerProfileUrl(merged, channel("#other"), "bob")).to.equal(null);
	});

	it("lets the user's address win over the server's, keeping its channels", function () {
		const merged = withUserTrackers(network([seedpool]), [
			{
				id: "sp",
				network: host,
				profileUrl: "https://seedpool.org/u/{ident}",
				userHost: "*.sp",
			},
		]);

		expect(merged.trackers).to.deep.equal([
			{...seedpool, profileUrl: "https://seedpool.org/u/{ident}", userHost: "*.sp"},
		]);
		expect(trackerProfileNeedsUser(merged, channel("#seedpool"))).to.equal(true);
		expect(
			resolveTrackerProfileUrl(merged, channel("#seedpool"), "carol", {
				ident: "42",
				hostname: "x.sp",
			})
		).to.equal("https://seedpool.org/u/42");
	});

	it("hides the server's link", function () {
		const merged = withUserTrackers(network([seedpool]), [
			{id: "SP", network: host, hidden: true},
		]);

		expect(resolveTrackerProfileUrl(merged, channel("#seedpool"), "dave")).to.equal(null);
	});

	it("never builds a link from an invalid stored address", function () {
		// As if written by an old client or by hand, without going through
		// parseUserTrackers
		const bad = "javascript:alert(1)//{nick}";
		const added = withUserTrackers(network(undefined), [mine({profileUrl: bad})]);
		const override = withUserTrackers(network([seedpool]), [
			{id: "SP", network: host, profileUrl: bad},
		]);

		expect(resolveTrackerProfileUrl(added, channel("#x"), "eve")).to.equal(null);
		expect(resolveTrackerProfileUrl(override, channel("#seedpool"), "eve")).to.equal(
			"https://seedpool.org/users/eve"
		);

		const parsed = parseUserTrackers(JSON.stringify([mine({profileUrl: bad})]));
		expect(
			resolveTrackerProfileUrl(
				withUserTrackers(network(undefined), parsed),
				channel("#x"),
				"eve"
			)
		).to.equal(null);
	});

	it("does not change the network it is given", function () {
		const net = network([seedpool]);
		const before = JSON.stringify(net);

		withUserTrackers(net, [mine({}), {id: "SP", network: host, hidden: true}]);

		expect(JSON.stringify(net)).to.equal(before);
	});
});

describe("user trackers and shoutbox bridge scoping", function () {
	const msg = (nick: string, text: string): SharedMsg => ({
		id: 1,
		type: MessageType.MESSAGE,
		time: new Date(),
		from: {nick, mode: ""},
		users: [],
		text,
	});

	it("a user-defined tracker cannot make a bridge matcher apply", function () {
		// "DP" is the tracker id the DarkPeers bridge matcher is scoped to.
		// A user adds a tracker with that id on a network the server has no
		// DP tracker for.
		const net = network(undefined);
		const userTrackers = parseUserTrackers(
			JSON.stringify([
				{id: "DP", network: host, name: "DP", profileUrl: "https://dp.example/{nick}"},
			])
		);
		const original = msg("dp", "[admin] hello");

		// The user's tracker does give profile links...
		expect(
			resolveTrackerProfileUrl(withUserTrackers(net, userTrackers), channel("#dp"), "x")
		).to.equal("https://dp.example/x");
		// ...but the bridge, which is given the network itself, is unaffected
		expect(parser(original, net, channel("#dp"))).to.equal(original);
	});

	it("an override cannot widen a server tracker's channels for the bridge", function () {
		const dp: TrackerInfo = {id: "DP", name: "DP", channels: ["#dp"]};
		const net = network([dp]);
		const merged = withUserTrackers(net, [
			{
				id: "DP",
				network: host,
				channels: ["#elsewhere"],
				profileUrl: "https://dp.example/{nick}",
			},
		]);
		const original = msg("dp", "[admin] hello");

		expect(merged.trackers?.[0].channels).to.deep.equal(["#dp"]);
		expect(parser(original, net, channel("#elsewhere"))).to.equal(original);
		expect(parser(original, net, channel("#dp")).from?.nick).to.equal("admin");
	});
});
