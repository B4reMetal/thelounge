import {expect} from "chai";
import {cancelAllHistoryRequests, startPendingJump} from "../../../client/js/chan.js";
import type {ClientChan, ClientNetwork} from "../../../client/js/types.js";

const chan = (id: number) => ({id, historyLoading: false}) as ClientChan;
const network = (channels: ClientChan[]) => ({channels}) as ClientNetwork;

describe("cancelAllHistoryRequests", function () {
	it("stops every channel from waiting for older messages", function () {
		const first = chan(1);
		const second = chan(2);
		first.historyLoading = true;
		second.historyLoading = true;

		cancelAllHistoryRequests([network([first]), network([second, chan(3)])]);

		expect(first.historyLoading).to.equal(false);
		expect(second.historyLoading).to.equal(false);
	});

	it("gives up jumps that are waiting for their answer", function () {
		const jumping = chan(4);
		let cancelled = false;
		startPendingJump(jumping, 1000, () => (cancelled = true));

		cancelAllHistoryRequests([network([jumping])]);

		expect(jumping.historyLoading).to.equal(false);
		expect(cancelled).to.equal(true);
	});
});
