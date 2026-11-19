import {expect} from "chai";

import {setTrackerKeySecret, trackerNetworkKey} from "../../server/plugins/trackerNetworks.js";

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
});
