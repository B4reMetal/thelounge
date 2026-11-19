import {expect} from "chai";
import topicCommand from "../../../../client/js/helpers/topicCommand.js";

describe("topicCommand helper", function () {
	it("sets the topic that was typed, spaces included", function () {
		expect(topicCommand("new topic")).to.equal("/topic new topic");
		expect(topicCommand(" padded ")).to.equal("/topic  padded ");
	});

	it("clears the topic when nothing was typed", function () {
		expect(topicCommand("")).to.equal("/cleartopic");
		expect(topicCommand("   ")).to.equal("/cleartopic");
	});
});
