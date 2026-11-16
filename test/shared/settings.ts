import {expect} from "chai";
import {migrateRenamedSettings} from "../../shared/settings.js";

describe("migrateRenamedSettings", function () {
	it("moves values saved under an old name to the new name", function () {
		const settings: Record<string, unknown> = {
			jumptoEabled: false,
			filterdmsEnabled: false,
			coloredNicks: true,
		};

		expect(migrateRenamedSettings(settings)).to.equal(true);
		expect(settings).to.deep.equal({
			jumpToEnabled: false,
			filterDmsEnabled: false,
			coloredNicks: true,
		});
	});

	it("keeps a value already saved under the new name", function () {
		const settings: Record<string, unknown> = {jumptoEabled: false, jumpToEnabled: true};

		expect(migrateRenamedSettings(settings)).to.equal(true);
		expect(settings).to.deep.equal({jumpToEnabled: true});
	});

	it("leaves current settings alone", function () {
		const settings: Record<string, unknown> = {jumpToEnabled: false, coloredNicks: true};

		expect(migrateRenamedSettings(settings)).to.equal(false);
		expect(settings).to.deep.equal({jumpToEnabled: false, coloredNicks: true});
	});
});
