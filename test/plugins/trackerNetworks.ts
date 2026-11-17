import {expect} from "chai";
import _ from "lodash";

import Config, {ConfigType} from "../../server/config.js";
import type Network from "../../server/models/network.js";
import {
	setTrackerKeySecret,
	trackerNetworkKey,
	trackerUserLookup,
} from "../../server/plugins/trackerNetworks.js";

describe("tracker network keys and ident lookups", function () {
	let saved: ConfigType["trackers"];
	let whois: string[];

	const identLookup = {
		lookup(network: Network, nick: string) {
			// Stands for the lookup that sends a WHOIS when it has to
			whois.push(`${network.host} ${nick}`);
			return Promise.resolve({ident: "42", hostname: "x"});
		},
	};
	const network = (host: string) => ({host}) as Network;
	const ask = (host: string, settings?: unknown) =>
		trackerUserLookup(identLookup, network(host), "alice", settings);
	const userSettings = (entries: unknown[]) => ({userTrackers: JSON.stringify(entries)});

	beforeEach(function () {
		saved = _.cloneDeep(Config.values.trackers);
		whois = [];
		Config.values.trackers = {
			NICK: {network: "irc.nick.example", profileUrl: "https://nick.example/u/{nick}"},
			IDENT: {network: "irc.ident.example", profileUrl: "https://ident.example/u/{ident}"},
		};
	});

	afterEach(function () {
		Config.values.trackers = saved;
	});

	it("derives a stable key that isn't the host", function () {
		setTrackerKeySecret("secret one");
		const key = trackerNetworkKey("irc.example.net");

		expect(key).to.match(/^[0-9a-f]{32}$/);
		expect(key).to.not.include("example");
		expect(trackerNetworkKey("IRC.Example.NET")).to.equal(key);
		expect(trackerNetworkKey("irc.other.net")).to.not.equal(key);

		setTrackerKeySecret("secret two");
		expect(trackerNetworkKey("irc.example.net")).to.not.equal(key);
		setTrackerKeySecret("secret one");
		expect(trackerNetworkKey("irc.example.net")).to.equal(key);
	});

	it("sends no WHOIS on a network with only {nick} trackers", async function () {
		const settings = userSettings([
			{
				id: "user-1",
				network: trackerNetworkKey("irc.nick.example"),
				name: "Mine",
				profileUrl: "https://mine.example/u/{nick}",
			},
		]);

		expect(await ask("irc.nick.example", settings)).to.equal(null);
		expect(whois).to.deep.equal([]);
	});

	it("answers for a server tracker with {ident}", async function () {
		expect(await ask("irc.ident.example")).to.deep.equal({ident: "42", hostname: "x"});
		expect(whois).to.deep.equal(["irc.ident.example alice"]);
	});

	it("answers for a user's {ident} tracker in their synced settings", async function () {
		const entry = {
			id: "user-1",
			network: trackerNetworkKey("irc.mine.example"),
			name: "Mine",
			profileUrl: "https://mine.example/u/{ident}",
		};

		expect(await ask("irc.mine.example", userSettings([entry]))).to.not.equal(null);
		// Not for another network, a hidden entry or one with a hostname
		// stored instead of the key
		expect(await ask("irc.other.example", userSettings([entry]))).to.equal(null);
		expect(await ask("irc.mine.example", userSettings([{...entry, hidden: true}]))).to.equal(
			null
		);
		expect(
			await ask("irc.mine.example", userSettings([{...entry, network: "irc.mine.example"}]))
		).to.equal(null);
		expect(whois).to.deep.equal(["irc.mine.example alice"]);
	});

	it("doesn't answer where there is no tracker, or no network", async function () {
		expect(await ask("irc.none.example")).to.equal(null);
		expect(await ask("irc.none.example", {userTrackers: "{broken"})).to.equal(null);
		expect(await ask("irc.none.example", "not settings")).to.equal(null);
		expect(await trackerUserLookup(identLookup, undefined, "alice", {})).to.equal(null);
		expect(whois).to.deep.equal([]);
	});
});
