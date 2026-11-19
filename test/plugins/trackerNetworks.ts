import {expect} from "chai";

import {
	bouncerNetworkName,
	setTrackerKeySecret,
	trackerNetworkKey,
} from "../../server/plugins/trackerNetworks.js";

describe("tracker network keys", function () {
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

	it("gives each network on a bouncer its own key", function () {
		setTrackerKeySecret("secret one");
		const plain = trackerNetworkKey("znc.example.net");
		const seedpool = trackerNetworkKey("znc.example.net", "seedpool");

		expect(trackerNetworkKey("znc.example.net", undefined)).to.equal(plain);
		expect(seedpool).to.match(/^[0-9a-f]{32}$/);
		expect(seedpool).to.not.equal(plain);
		expect(trackerNetworkKey("znc.example.net", "aither")).to.not.equal(seedpool);
		expect(trackerNetworkKey("ZNC.example.net", "SeedPool")).to.equal(seedpool);
		expect(trackerNetworkKey("other.example.net", "seedpool")).to.not.equal(seedpool);
	});
});

describe("bouncerNetworkName", function () {
	it("reads the network from a ZNC or soju username", function () {
		expect(bouncerNetworkName("alice@lounge/Seedpool")).to.equal("seedpool");
		expect(bouncerNetworkName("alice/Seedpool")).to.equal("seedpool");
		expect(bouncerNetworkName("alice/seedpool@lounge")).to.equal("seedpool");
	});

	it("reads it from the password when the username doesn't name one", function () {
		expect(bouncerNetworkName("alice", "alice@lounge/Aither:p/a:ss")).to.equal("aither");
		expect(bouncerNetworkName("", "alice/Aither:pass")).to.equal("aither");
		expect(bouncerNetworkName("alice@lounge/Seedpool", "x/Aither:pass")).to.equal("seedpool");
	});

	it("is undefined for a login that doesn't pick a network", function () {
		expect(bouncerNetworkName()).to.equal(undefined);
		expect(bouncerNetworkName("alice")).to.equal(undefined);
		expect(bouncerNetworkName("alice@lounge")).to.equal(undefined);
		expect(bouncerNetworkName("alice@lounge/")).to.equal(undefined);
		expect(bouncerNetworkName("/Seedpool")).to.equal(undefined);
		expect(bouncerNetworkName("alice", "plain password")).to.equal(undefined);
		expect(bouncerNetworkName("alice", "my pass/x:y")).to.equal(undefined);
		expect(bouncerNetworkName("alice", ":x/y")).to.equal(undefined);
	});
});
