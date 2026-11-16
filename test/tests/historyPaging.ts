import {expect} from "chai";

import Chan from "../../server/models/chan.js";
import Client from "../../server/client.js";
import Msg from "../../server/models/msg.js";
import Config from "../../server/config.js";
import MassEventAggregator from "../../server/plugins/massEventAggregator.js";
import {ChanType} from "../../shared/types/chan.js";

// In-memory stand-in for SqliteMessageStorage, holding rows oldest first
function fakeProvider(stored: Msg[]) {
	return {
		isEnabled: true,
		reads: 0,
		canProvideMessages: () => true,
		getMessages(_network: unknown, _chan: unknown, ensureIdAbove: (maxId: number) => void) {
			this.reads++;
			const page = stored.slice(-Config.values.maxHistory);
			ensureIdAbove(Math.max(0, ...page.map((m) => m.id)));
			return Promise.resolve(page);
		},
		getMessagesBefore(
			_uuid: string,
			_name: string,
			beforeTime: number,
			limit: number,
			inclusive = false
		) {
			const older = stored.filter((m) =>
				inclusive ? m.time.getTime() <= beforeTime : m.time.getTime() < beforeTime
			);
			return Promise.resolve(older.slice(-limit));
		},
	};
}

function message(id: number) {
	const msg = new Msg({time: new Date(id * 1000), text: `message ${id}`});
	msg.id = id;
	return msg;
}

function setup(storedCount: number) {
	const stored = Array.from({length: storedCount}, (_, i) => message(i + 1));
	const provider = fakeProvider(stored);
	const chan = new Chan({name: "#paging", type: ChanType.CHANNEL});
	const network = {uuid: "net", name: "net", irc: {network: {cap: {isEnabled: () => false}}}};
	const emitted: {event: string; data: any}[] = [];

	const client = Object.create(Client.prototype);
	Object.assign(client, {
		name: "tester",
		idMsg: 1,
		config: {clientSettings: {}},
		messageProvider: provider,
		emit: (event: string, data: unknown) => emitted.push({event, data}),
		find: () => ({network, chan}),
	});
	client.massEventAggregator = new MassEventAggregator(client);

	return {stored, provider, chan, network, client: client as Client, emitted};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("History paging", function () {
	let originalMaxHistory: number;

	before(function () {
		originalMaxHistory = Config.values.maxHistory;
		Config.values.maxHistory = 150;
	});

	after(function () {
		Config.values.maxHistory = originalMaxHistory;
	});

	it("reads stored history once, however often it is asked to", async function () {
		const {chan, network, client, provider, emitted} = setup(400);

		chan.loadMessages(client, network as any, true);
		chan.loadMessages(client, network as any, true);
		await settle();

		expect(provider.reads).to.equal(1);
		expect(chan.messages.map((m) => m.id)).to.deep.equal(
			Array.from({length: 150}, (_, i) => 251 + i)
		);
		expect(client.idMsg).to.equal(401);

		expect(emitted).to.have.lengthOf(1);
		expect(emitted[0].data.messages).to.have.lengthOf(100);
		expect(emitted[0].data.hasMore).to.equal(true);
	});

	it("does not duplicate messages that arrived before the first open", async function () {
		const {chan, network, client, stored} = setup(50);

		// arrived live since startup: already in memory and already logged
		chan.messages.push(stored[48], stored[49]);

		chan.loadMessages(client, network as any, true);
		await settle();

		expect(chan.messages.map((m) => m.id)).to.deep.equal(
			Array.from({length: 50}, (_, i) => i + 1)
		);
	});

	it("keeps a stored message that only shares its id with one in memory", async function () {
		const {chan, network, client, stored} = setup(50);

		// arrived live, and happens to reuse the id of a stored message
		// written by an earlier run of the server
		const live = message(10);
		live.time = new Date(100 * 1000);
		chan.messages.push(live);

		chan.loadMessages(client, network as any, true);
		await settle();

		expect(chan.messages).to.have.lengthOf(51);
		expect(chan.messages.slice(0, 50)).to.deep.equal(stored);
		expect(chan.messages[50]).to.equal(live);
	});

	it("keeps stored pages that share ids with messages in memory", async function () {
		const {chan, network, client} = setup(400);

		chan.loadMessages(client, network as any, true);
		await settle();

		// memory holds 251-400. Give one of them the id of an older stored
		// message, as ids from before they survived restarts can repeat.
		chan.messages[chan.messages.length - 1].id = 200;

		const page = await client.more({target: chan.id, lastId: 251, condensed: false});
		const ids = page!.messages.map((m) => m.id);

		expect(ids).to.include(200);
		expect(ids).to.not.include(251);
		expect(ids[ids.length - 1]).to.equal(250);
	});

	it("tells clients when a channel has no stored history", async function () {
		const {chan, network, client, emitted} = setup(0);

		chan.loadMessages(client, network as any, true);
		await settle();

		expect(emitted).to.have.lengthOf(1);
		expect(emitted[0].data.messages).to.have.lengthOf(0);
		expect(emitted[0].data.hasMore).to.equal(false);
	});

	it("pages through memory, then storage, down to the first message", async function () {
		const {chan, network, client} = setup(400);

		chan.loadMessages(client, network as any, true);
		await settle();

		// what a client does: start with the newest page, keep asking for older
		const seen: number[] = [];
		let lastId = -1;
		let hasMore = true;
		let requests = 0;

		while (hasMore) {
			const page = await client.more({
				target: chan.id,
				lastId,
				condensed: false,
				beforeTime: seen.length ? seen[0] * 1000 : undefined,
			});

			const fresh = page!.messages.map((m) => m.id).filter((id) => !seen.includes(id));
			seen.unshift(...fresh);
			lastId = seen[0];
			hasMore = page!.hasMore;

			expect(++requests).to.be.lessThan(20, "paging did not terminate");
		}

		expect(seen).to.deep.equal(Array.from({length: 400}, (_, i) => i + 1));
		// storage pages are served from disk, they must not pile up in memory
		expect(chan.messages).to.have.lengthOf(150);
	});

	it("never sends more than a page from storage", async function () {
		const {chan, network, client} = setup(400);

		chan.loadMessages(client, network as any, true);
		await settle();

		// memory holds 251..400, so this page comes from storage alone
		const page = await client.more({
			target: chan.id,
			lastId: 251,
			lastTime: 251 * 1000,
			condensed: false,
			beforeTime: 251 * 1000,
		});

		expect(page!.messages.map((m) => m.id)).to.deep.equal(
			Array.from({length: 100}, (_, i) => i + 151)
		);
		expect(page!.hasMore).to.equal(true);
	});

	it("finds the message to page from by id and time", async function () {
		const {chan, network, client} = setup(400);

		chan.loadMessages(client, network as any, true);
		await settle();

		// an older message that shares its id with a newer one in memory
		chan.messages[20].id = chan.messages[120].id;

		const page = await client.more({
			target: chan.id,
			lastId: chan.messages[120].id,
			lastTime: chan.messages[120].time.getTime(),
			condensed: false,
		});

		expect(page!.messages).to.have.lengthOf(100);
		expect(page!.messages[99]).to.equal(chan.messages[119]);
	});

	it("reports no more history when memory holds everything", async function () {
		const {chan, network, client} = setup(60);

		chan.loadMessages(client, network as any, true);
		await settle();

		const page = await client.more({target: chan.id, lastId: -1, condensed: false});

		expect(page!.messages).to.have.lengthOf(60);
		expect(page!.hasMore).to.equal(false);
	});
});
