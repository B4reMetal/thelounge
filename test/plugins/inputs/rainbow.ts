import {expect} from "chai";
import {rainbow} from "../../../server/plugins/inputs/rainbow.js";

describe("rainbow", function () {
	it("colours each character in turn and skips spaces", function () {
		expect(rainbow("ab c")).to.equal("\x034a\x037b \x039c");
	});

	it("wraps around the colour list", function () {
		const out = rainbow("abcdefghijkl");
		expect(out.startsWith("\x034a")).to.equal(true);
		// 12th character uses the first colour again
		expect(out.endsWith("\x034l")).to.equal(true);
	});

	it("pads colour codes followed by a digit to two digits", function () {
		expect(rainbow("a1b2")).to.equal("\x034a\x03071\x038b\x03092");
		// Two-digit colours are not padded further
		expect(rainbow("abcdef9")).to.equal("\x034a\x037b\x038c\x039d\x033e\x0310f\x03119");
	});

	it("passes formatting characters through", function () {
		expect(rainbow("\x02a\x0F")).to.equal("\x02\x037a\x0F");
	});

	it("does not split emoji or other astral characters", function () {
		const out = rainbow("a😀b");
		expect(out).to.equal("\x034a\x037😀\x038b");
		// No lone surrogates
		expect(out.isWellFormed()).to.equal(true);
	});

	it("keeps grapheme clusters together", function () {
		const family = "👨‍👩‍👧";
		const flag = "🇯🇵";
		const accented = "é";
		expect(rainbow(family + flag + accented)).to.equal(
			`\x034${family}\x037${flag}\x038${accented}`
		);
	});

	it("pads before a keycap emoji that starts with a digit", function () {
		expect(rainbow("1️⃣")).to.equal("\x03041️⃣");
	});
});
