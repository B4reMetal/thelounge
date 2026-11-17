import {expect} from "chai";

import {startsNewDay, unreadMarkerIndex} from "../../client/js/helpers/messageMarkers.js";

// 600 entries, ten minutes apart, starting at midnight: days change at 0, 144, 288, 432 and 576
const day = new Date(2026, 0, 1).getTime();
const entries = Array.from({length: 600}, (_, i) => ({
	id: i + 1,
	time: new Date(day + i * 10 * 60 * 1000),
}));

// Which rows of a window of `size` entries starting at `start` get a marker
function rendered(start: number, size: number, marked: (index: number) => boolean) {
	const rows: number[] = [];

	for (let idx = 0; idx < size; idx++) {
		if (marked(start + idx)) {
			rows.push(start + idx);
		}
	}

	return rows;
}

describe("Message list markers", function () {
	it("puts date markers only at day changes, also at the start of a window", function () {
		expect(rendered(0, 500, (i) => startsNewDay(entries, i))).to.deep.equal([0, 144, 288, 432]);
		// the first rendered row is the same day as the entry before it
		expect(rendered(100, 500, (i) => startsNewDay(entries, i))).to.deep.equal([
			144, 288, 432, 576,
		]);
		// a window starting at a day change still marks it
		expect(rendered(288, 300, (i) => startsNewDay(entries, i))).to.deep.equal([288, 432, 576]);
	});

	it("takes string times as sent over the socket", function () {
		const fromJson = entries.map((e) => ({...e, time: e.time.toISOString()}));
		expect(startsNewDay(fromJson, 144)).to.equal(true);
		expect(startsNewDay(fromJson, 145)).to.equal(false);
	});

	it("puts the unread marker after the last read entry of the full list", function () {
		const index = unreadMarkerIndex(entries, 300);
		expect(index).to.equal(300);
		expect(rendered(100, 500, (i) => i === index)).to.deep.equal([300]);
	});

	it("doesn't put the unread marker on the first rendered row when unread starts before the window", function () {
		const index = unreadMarkerIndex(entries, 50);
		expect(index).to.equal(50);
		expect(rendered(100, 500, (i) => i === index)).to.deep.equal([]);
	});

	it("has no unread marker when everything is read", function () {
		expect(unreadMarkerIndex(entries, 600)).to.equal(-1);
		expect(unreadMarkerIndex([], 0)).to.equal(-1);
	});
});
