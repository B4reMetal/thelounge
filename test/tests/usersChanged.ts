import {expect} from "chai";
import sinon from "sinon";
import Client from "../../server/client.js";
import Chan from "../../server/models/chan.js";

// usersChanged() needs only emit() and its own bookkeeping, so it runs on a
// stand-in instead of a full Client
function fakeClient() {
	const emitted: unknown[] = [];
	const proto = Client.prototype as unknown as Record<string, unknown>;
	const fake = {
		emit: (_event: string, data: unknown) => emitted.push(data),
		usersNotices: new Map(),
		holdUsersNotices: proto.holdUsersNotices,
		usersChanged: proto.usersChanged,
	} as unknown as Client;
	return {client: fake, emitted};
}

describe("User list change notices", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		clock = sinon.useFakeTimers();
	});

	afterEach(function () {
		clock.restore();
	});

	it("announces the first change straight away", function () {
		const {client, emitted} = fakeClient();
		client.usersChanged(new Chan({id: 1}));

		expect(emitted).to.deep.equal([{chan: 1}]);
	});

	it("sends a burst of changes as one more notice after the interval", function () {
		const {client, emitted} = fakeClient();
		const chan = new Chan({id: 1});

		for (let i = 0; i < 1000; i++) {
			client.usersChanged(chan);
		}

		expect(emitted).to.have.length(1);
		clock.tick(500);
		expect(emitted).to.have.length(2);

		// Nothing changed since: no further notice
		clock.tick(5000);
		expect(emitted).to.have.length(2);
	});

	it("announces again straight away once a quiet interval has passed", function () {
		const {client, emitted} = fakeClient();
		const chan = new Chan({id: 1});

		client.usersChanged(chan);
		clock.tick(500);
		client.usersChanged(chan);

		expect(emitted).to.have.length(2);
	});

	it("keeps channels apart", function () {
		const {client, emitted} = fakeClient();

		client.usersChanged(new Chan({id: 1}));
		client.usersChanged(new Chan({id: 2}));

		expect(emitted).to.deep.equal([{chan: 1}, {chan: 2}]);
	});
});
