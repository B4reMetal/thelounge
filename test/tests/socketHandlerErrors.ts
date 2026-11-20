import {EventEmitter} from "events";
import {expect} from "chai";
import sinon from "sinon";
import log from "../../server/log.js";
import {catchHandlerErrors} from "../../server/server.js";

type Socket = Parameters<typeof catchHandlerErrors>[0];

// What catchHandlerErrors needs of a socket.io socket: on() and the address
function fakeSocket() {
	const socket = new EventEmitter() as EventEmitter & {handshake: unknown};
	socket.handshake = {address: "192.0.2.1", headers: {}};
	return socket;
}

describe("Socket handler errors", function () {
	let errorStub: sinon.SinonStub;

	beforeEach(function () {
		errorStub = sinon.stub(log, "error");
	});

	afterEach(function () {
		errorStub.restore();
	});

	it("logs an exception from a handler instead of throwing it", function () {
		const socket = fakeSocket();
		catchHandlerErrors(socket as unknown as Socket);

		socket.on("input", (data: {text: string}) => data.text.split("\n"));

		expect(() => socket.emit("input", {text: 5})).to.not.throw();
		expect(errorStub.calledOnce).to.equal(true);
		expect(errorStub.firstCall.args[0]).to.contain('Socket event "input" from 192.0.2.1');
		expect(errorStub.firstCall.args[0]).to.contain("TypeError");
	});

	it("logs a rejection from an async handler", async function () {
		const socket = fakeSocket();
		catchHandlerErrors(socket as unknown as Socket);

		// socket.io handlers may be async; EventEmitter's types expect void
		const handler = () => Promise.reject(new Error("database is locked"));
		socket.on("search", handler as () => void);
		socket.emit("search", {});

		await new Promise((resolve) => setImmediate(resolve));
		expect(errorStub.calledOnce).to.equal(true);
		expect(errorStub.firstCall.args[0]).to.contain("database is locked");
	});

	it("passes arguments and the socket through to the handler", function () {
		const socket = fakeSocket();
		catchHandlerErrors(socket as unknown as Socket);

		let seen: unknown[] = [];
		let calledOnSocket = false;

		socket.on("names", function (this: unknown, ...args: unknown[]) {
			calledOnSocket = this === socket;
			seen = args;
		});
		socket.emit("names", 1, "two");

		expect(seen).to.deep.equal([1, "two"]);
		expect(calledOnSocket).to.equal(true);
		expect(errorStub.called).to.equal(false);
	});

	it("still removes a handler with off() and runs a once() handler once", function () {
		const socket = fakeSocket();
		catchHandlerErrors(socket as unknown as Socket);

		let calls = 0;
		const handler = () => calls++;

		socket.on("auth:perform", handler);
		socket.off("auth:perform", handler);
		socket.emit("auth:perform");

		socket.once("names", handler);
		socket.emit("names");
		socket.emit("names");

		expect(calls).to.equal(1);
		expect(socket.listenerCount("auth:perform")).to.equal(0);
		expect(socket.listenerCount("names")).to.equal(0);
	});
});
