import {expect} from "chai";
import sinon from "sinon";
import log from "../../server/log.js";
import pkg from "../../package.json" with {type: "json"};
import changelog, {
	RELEASES_PAGE_URL,
	RELEASES_REPOSITORY,
	updateVersions,
} from "../../server/plugins/changelog.js";

const current = `v${pkg.version}`;

function release(tag: string, extra: Record<string, unknown> = {}) {
	return {
		tag_name: tag,
		body_html: `<p>${tag}</p>`,
		prerelease: false,
		draft: false,
		html_url: `https://github.com/${RELEASES_REPOSITORY}/releases/tag/${tag}`,
		...extra,
	};
}

describe("changelog", function () {
	it("uses this fork's repository", function () {
		expect(RELEASES_REPOSITORY).to.equal("fHori/thelounge");
		expect(RELEASES_PAGE_URL).to.equal("https://github.com/fHori/thelounge/releases");
	});

	describe("updateVersions", function () {
		it("reports no update when the fork has no releases", function () {
			const versions = updateVersions("[]");

			expect(changelog.isUpdateAvailable).to.equal(false);
			expect(versions.latest).to.equal(undefined);
			expect(versions.current.changelog).to.equal(undefined);
			expect(versions.current.url).to.equal(RELEASES_PAGE_URL);
		});

		it("picks up the current release and a newer one", function () {
			const versions = updateVersions(
				JSON.stringify([release("v9999.0.0"), release("v9998.0.0"), release(current)])
			);

			expect(versions.current.changelog).to.equal(`<p>${current}</p>`);
			expect(versions.current.url).to.equal(
				`https://github.com/fHori/thelounge/releases/tag/${current}`
			);
			expect(changelog.isUpdateAvailable).to.equal(true);
			expect(versions.latest).to.deep.equal({
				prerelease: false,
				version: "v9999.0.0",
				url: "https://github.com/fHori/thelounge/releases/tag/v9999.0.0",
			});
		});

		it("does not offer an older release when the current one is missing", function () {
			const versions = updateVersions(JSON.stringify([release("v0.0.2"), release("v0.0.1")]));

			expect(changelog.isUpdateAvailable).to.equal(false);
			expect(versions.latest).to.equal(undefined);
			expect(versions.current.url).to.equal(RELEASES_PAGE_URL);
		});

		it("ignores pre-releases, drafts and malformed entries", function () {
			const versions = updateVersions(
				JSON.stringify([
					release("v9999.0.0-rc.1", {prerelease: true}),
					release("v9998.0.0", {draft: true}),
					release("not-a-version"),
					{tag_name: "v9997.0.0"},
					null,
					release(current),
				])
			);

			expect(changelog.isUpdateAvailable).to.equal(false);
			expect(versions.latest).to.equal(undefined);
		});

		it("clears a previously found update", function () {
			updateVersions(JSON.stringify([release("v9999.0.0")]));
			expect(changelog.isUpdateAvailable).to.equal(true);

			const versions = updateVersions(JSON.stringify({message: "Not Found"}));
			expect(changelog.isUpdateAvailable).to.equal(false);
			expect(versions.latest).to.equal(undefined);
		});
	});

	describe("fetch", function () {
		let fetchStub: sinon.SinonStub;
		let errorStub: sinon.SinonStub;

		beforeEach(function () {
			updateVersions("[]").expiresAt = -1;
			fetchStub = sinon.stub(globalThis, "fetch");
			errorStub = sinon.stub(log, "error");
		});

		afterEach(function () {
			fetchStub.restore();
			errorStub.restore();
			updateVersions("[]").expiresAt = -1;
		});

		it("queries this fork's releases and treats an empty list as up to date", async function () {
			fetchStub.resolves(new Response("[]", {status: 200}));

			const versions = await changelog.fetch();

			expect(fetchStub.calledOnce).to.equal(true);
			expect(fetchStub.firstCall.args[0]).to.equal(
				"https://api.github.com/repos/fHori/thelounge/releases"
			);
			expect(versions.expiresAt).to.be.greaterThan(Date.now());
			expect(versions.latest).to.equal(undefined);
			expect(changelog.isUpdateAvailable).to.equal(false);
			expect(errorStub.called).to.equal(false);
		});

		it("stays quiet on a non-200 response", async function () {
			fetchStub.resolves(new Response("{}", {status: 404}));

			const versions = await changelog.fetch();

			expect(versions.expiresAt).to.equal(-1);
			expect(versions.latest).to.equal(undefined);
			expect(errorStub.called).to.equal(false);
		});
	});
});
