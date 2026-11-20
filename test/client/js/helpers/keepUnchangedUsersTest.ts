import {expect} from "chai";
import keepUnchangedUsers from "../../../../client/js/helpers/keepUnchangedUsers.js";
import type {ClientUser} from "../../../../client/js/types.js";

const user = (nick: string, modes: string[] = [], lastMessage = 0) =>
	({nick, modes, mode: modes[0] || "", away: "", lastMessage}) as ClientUser;

describe("keepUnchangedUsers helper", function () {
	it("keeps the old object for a user whose modes did not change", function () {
		const alice = user("alice", ["@"]);
		const bob = user("bob");
		const result = keepUnchangedUsers([alice, bob], [user("alice", ["@"]), user("bob")]);

		expect(result[0]).to.equal(alice);
		expect(result[1]).to.equal(bob);
	});

	it("uses the new object for a user whose modes changed", function () {
		const alice = user("alice");
		const opped = user("alice", ["@"]);

		expect(keepUnchangedUsers([alice], [opped])[0]).to.equal(opped);
	});

	it("uses the new object for a user whose away status changed", function () {
		const alice = user("alice");
		const away = {...user("alice"), away: "lunch"};

		expect(keepUnchangedUsers([alice], [away])[0]).to.equal(away);
	});

	it("follows the new list: order, joins and parts", function () {
		const alice = user("alice");
		const bob = user("bob");
		const carol = user("carol");
		const result = keepUnchangedUsers([alice, bob], [carol, user("alice")]);

		expect(result.map((u) => u.nick)).to.deep.equal(["carol", "alice"]);
		expect(result[0]).to.equal(carol);
		expect(result[1]).to.equal(alice);
	});

	it("keeps the newer lastMessage of the two", function () {
		const alice = user("alice", [], 200);
		const bob = user("bob", [], 100);
		const result = keepUnchangedUsers(
			[alice, bob],
			[user("alice", [], 150), user("bob", [], 300)]
		);

		expect(result[0].lastMessage).to.equal(200);
		expect(result[1].lastMessage).to.equal(300);
	});

	it("returns the new list as is when there was none", function () {
		const incoming = [user("alice")];
		expect(keepUnchangedUsers([], incoming)).to.equal(incoming);
	});
});
