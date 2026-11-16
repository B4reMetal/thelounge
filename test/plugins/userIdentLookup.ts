import {expect} from "chai";

import Chan from "../../server/models/chan.js";
import User from "../../server/models/user.js";
import type Network from "../../server/models/network.js";
import UserIdentLookup from "../../server/plugins/userIdentLookup.js";

function setup() {
	const sent: string[][] = [];
	const chan = new Chan({name: "#tracker"});
	const network = {
		uuid: "net",
		channels: [chan],
		irc: {connected: true, raw: (...args: string[]) => sent.push(args)},
	};

	return {lookup: new UserIdentLookup(), chan, sent, network: network as unknown as Network};
}

describe("UserIdentLookup", function () {
	it("answers from what the server already said, without a WHOIS", async function () {
		const {lookup, chan, sent, network} = setup();
		chan.setUser(new User({nick: "Alice", ident: "66434", hostname: "alice.elite.example"}));

		expect(await lookup.lookup(network, "alice")).to.deep.equal({
			ident: "66434",
			hostname: "alice.elite.example",
		});
		expect(sent).to.deep.equal([]);
	});

	it("asks again when the known ident is not a user id", async function () {
		const {lookup, chan, sent, network} = setup();
		chan.setUser(new User({nick: "Mallory", ident: "~mallory", hostname: "m.example"}));

		const pending = lookup.lookup(network, "mallory");
		expect(sent).to.deep.equal([["WHOIS", "mallory"]]);

		lookup.handleWhois(network, {nick: "mallory", ident: "4321", hostname: "m.example"});
		expect(await pending).to.deep.equal({ident: "4321", hostname: "m.example"});
	});

	it("sends one WHOIS for a user it knows nothing about and hides the reply", async function () {
		const {lookup, chan, sent, network} = setup();
		chan.setUser(new User({nick: "Bob"}));

		const first = lookup.lookup(network, "Bob");
		const second = lookup.lookup(network, "bob");

		expect(sent).to.deep.equal([["WHOIS", "Bob"]]);

		const hidden = lookup.handleWhois(network, {
			nick: "bob",
			ident: "75412",
			hostname: "bob.elite.example",
		});

		expect(hidden).to.equal(true);
		expect(await first).to.deep.equal({ident: "75412", hostname: "bob.elite.example"});
		expect(await second).to.deep.equal(await first);

		// remembered, so the next lookup needs no WHOIS
		expect(await lookup.lookup(network, "BOB")).to.deep.equal(await first);
		expect(sent).to.have.lengthOf(1);
	});

	it("doesn't send a WHOIS for something that isn't a nick", async function () {
		const {lookup, sent, network} = setup();

		for (const nick of ["", "a b", "a,b", "a*", "#chan", "a\r\nQUIT", "x".repeat(65)]) {
			expect(await lookup.lookup(network, nick)).to.equal(null);
		}

		expect(sent).to.deep.equal([]);
	});

	it("waits for a few WHOIS replies per network at most", async function () {
		const {lookup, sent, network} = setup();

		for (let i = 0; i < 5; i++) {
			void lookup.lookup(network, `user${i}`);
		}

		expect(await lookup.lookup(network, "user5")).to.equal(null);
		expect(sent).to.have.lengthOf(5);

		// once one is answered there is room again
		lookup.handleWhois(network, {nick: "user0", ident: "1", hostname: "h"});
		void lookup.lookup(network, "user5");
		expect(sent).to.have.lengthOf(6);
		lookup.clear();
	});

	it("leaves a WHOIS reply nobody is waiting for alone", function () {
		const {lookup, network} = setup();

		expect(lookup.handleWhois(network, {nick: "carol", ident: "1", hostname: "h"})).to.equal(
			false
		);
	});

	it("shows the reply when the user asked for the same WHOIS meanwhile", async function () {
		const {lookup, network} = setup();
		const pending = lookup.lookup(network, "dave");

		lookup.shownWhoisRequested(network, "Dave");
		expect(lookup.isHidden(network, "dave")).to.equal(false);

		expect(lookup.handleWhois(network, {nick: "dave", ident: "7", hostname: "h"})).to.equal(
			false
		);
		expect(await pending).to.deep.equal({ident: "7", hostname: "h"});
	});

	it("answers with nothing for a nick that doesn't exist, and hides that too", async function () {
		const {lookup, network} = setup();
		const pending = lookup.lookup(network, "nobody");

		// the "No such nick" error that comes first is hidden as well
		expect(lookup.isHidden(network, "NoBody")).to.equal(true);
		expect(lookup.isHidden(network, "somebody")).to.equal(false);
		expect(lookup.handleWhois(network, {nick: "nobody", error: true})).to.equal(true);
		expect(lookup.isHidden(network, "nobody")).to.equal(false);
		expect(await pending).to.equal(null);
	});

	it("answers with nothing when disconnected or when dropped", async function () {
		const {lookup, network} = setup();
		const pending = lookup.lookup(network, "erin");

		lookup.clear();
		expect(await pending).to.equal(null);
		// the late reply is an ordinary one again
		expect(lookup.handleWhois(network, {nick: "erin", ident: "1", hostname: "h"})).to.equal(
			false
		);

		network.irc!.connected = false;
		expect(await lookup.lookup(network, "frank")).to.equal(null);
	});
});
