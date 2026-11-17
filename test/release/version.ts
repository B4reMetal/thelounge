import {expect} from "chai";
import semver from "semver";
// @ts-expect-error plain ESM script without type declarations
import * as V from "../../scripts/release/version.mjs";
// @ts-expect-error plain ESM script without type declarations
import * as N from "../../scripts/release/notes.mjs";

const at = (d: string) => new Date(`${d}T12:00:00Z`);
// Every stock tag shape that exists in the inherited history
const stock = ["v1.0.0", "v2.0.0-pre.1", "v3.0.0-rc.6", "v4.4.3", "v4.5.2", "v4.6.0-pre.2"];

describe("release version scheme", function () {
	it("ignores stock tags and starts at YYYY.M.0", function () {
		const r = V.nextVersion({tags: stock, now: at("2026-11-16")});
		expect(r).to.include({
			version: "2026.11.0",
			tag: "v2026.11.0",
			latest: true,
			previousTag: "",
		});
	});

	it("sorts above every stock version, as the semver package does", function () {
		for (const s of stock) {
			expect(semver.gt("2026.1.0", s.slice(1))).to.equal(true);
		}

		const list = [
			"2026.11.0",
			"2026.11.1-rc.1",
			"2026.11.1-rc.10",
			"2026.11.1-rc.2",
			"2026.12.0",
			"2026.11.10",
		];
		expect([...list].sort(V.compare)).to.deep.equal([...list].sort(semver.compare));
	});

	it("bumps the patch within a month and starts a new line in a new month", function () {
		const tags = [...stock, "v2026.11.0"];
		expect(V.nextVersion({tags, now: at("2026-11-30")}).version).to.equal("2026.11.1");
		expect(V.nextVersion({tags, now: at("2026-12-01")}).version).to.equal("2026.12.0");
		expect(V.nextVersion({tags, bump: "patch", now: at("2027-02-01")}).version).to.equal(
			"2026.11.1"
		);
	});

	it("numbers release candidates and finalises them", function () {
		const tags = ["v2026.11.0", "v2026.11.1-rc.1"];
		const rc = V.nextVersion({tags, prerelease: true, now: at("2026-11-20")});
		expect(rc).to.include({
			version: "2026.11.1-rc.2",
			prerelease: true,
			latest: false,
			previousTag: "v2026.11.1-rc.1",
		});
		const final = V.nextVersion({tags, now: at("2026-11-20")});
		expect(final).to.include({version: "2026.11.1", latest: true, previousTag: "v2026.11.0"});
	});

	it("does not move latest for a fix to an older line", function () {
		const r = V.nextVersion({tags: ["v2026.11.0", "v2026.12.0"], explicit: "v2026.11.1"});
		expect(r).to.include({latest: false, lineLatest: true, exists: false});
		expect(V.nextVersion({tags: ["v2026.11.0"], explicit: "2026.11.0"}).exists).to.equal(true);
	});

	it("rejects versions outside the scheme", function () {
		for (const bad of [
			"4.4.3-hori.1",
			"2026.01.0",
			"2026.13.0",
			"2026.11.0+x",
			"2026.11.0-beta.1",
		]) {
			expect(() => V.nextVersion({tags: [], explicit: bad}), bad).to.throw();
		}
	});

	it("computes image tags per channel", function () {
		const sha = "0123456789abcdef";
		expect(V.imageTags({channel: "edge", sha})).to.deep.equal(["edge", "sha-0123456"]);
		expect(
			V.imageTags({
				channel: "release",
				version: "2026.11.1",
				sha,
				latest: true,
				lineLatest: true,
			})
		).to.deep.equal(["2026.11.1", "sha-0123456", "2026.11", "latest"]);
		expect(V.imageTags({channel: "release", version: "2026.11.1", sha})).to.deep.equal([
			"2026.11.1",
			"sha-0123456",
		]);
		expect(V.imageTags({channel: "prerelease", version: "2026.12.0-rc.1", sha})).to.deep.equal([
			"2026.12.0-rc.1",
			"next",
			"sha-0123456",
		]);
		expect(V.imageTags({channel: "none"})).to.deep.equal([]);
		// a release cut from master is also master's newest build
		expect(
			V.imageTags({channel: "release", version: "2026.11.1", sha, latest: true, edge: true})
		).to.deep.equal(["2026.11.1", "sha-0123456", "latest", "edge"]);
		expect(
			V.imageTags({channel: "prerelease", version: "2026.12.0-rc.1", sha, edge: true})
		).to.include("edge");
		expect(() => V.imageTags({channel: "release", version: "2026.12.0-rc.1", sha})).to.throw();
	});
});

describe("release notes", function () {
	it("groups merged branches by prefix and skips bump commits", function () {
		const body = N.render({
			version: "2026.11.0",
			image: "img",
			storageChanged: true,
			commits: [
				{
					subject: "Merge pull request #14 from someone/perf/fast",
					body: "\nMake it fast\n",
				},
				{
					subject: "Merge pull request #15 from someone/fix/thing",
					body: "Fix @someone's thing, see a/b#3",
				},
				{subject: "Release v2026.10.0", body: ""},
				{subject: "Fix /list paging (#21)", body: ""},
			],
		});
		expect(body).to.include("## Performance\n\n- Make it fast");
		expect(body).to.include("- Fix `@someone`'s thing, see `a/b#3`");
		expect(body).to.include("## Other changes\n\n- Fix /list paging\n");
		expect(body).to.include("[!WARNING]");
		expect(body).not.to.include("Release v2026");
	});

	it("links pull requests merged from this repository, and only those", function () {
		const body = N.render({
			version: "2026.11.0",
			image: "img",
			storageChanged: false,
			repository: "fHori/thelounge",
			commits: [
				{
					subject: "Merge pull request #16 from fHori/fix/upload-auth",
					body: "Require a token",
				},
				{subject: "Merge pull request #10 from someone-else/fix/other", body: "Other fork"},
				{subject: "Fix a thing (#5013)", body: ""},
			],
		});
		expect(body).to.include(
			"- Require a token ([#16](https://github.com/fHori/thelounge/pull/16))"
		);
		expect(body).to.include("- Other fork\n");
		expect(body).to.include("- Fix a thing\n");
		expect(body).not.to.include("5013");
	});

	it("lists dependency updates and Docker changes in their own sections", function () {
		const body = N.render({
			version: "2026.11.0",
			image: "img",
			storageChanged: false,
			commits: [
				{
					subject:
						"Merge pull request #30 from someone/dependabot/npm_and_yarn/minor-and-patch-1a2b3c",
					body: "Bump the minor-and-patch group with 4 updates",
				},
				{subject: "deps: bump undici from 7.30.2 to 7.31.0", body: ""},
				{
					subject: "Merge pull request #26 from someone/docker/puid-pgid",
					body: "Docker: PUID/PGID support",
				},
			],
		});
		expect(body).to.include(
			"## Dependencies\n\n- Bump the minor-and-patch group with 4 updates\n- deps: bump undici"
		);
		expect(body).to.include("## Features\n\n- Docker: PUID/PGID support");
		expect(body).not.to.include("[!WARNING]");
	});

	it("reads the schema version that decides the storage warning", function () {
		expect(
			N.schemaVersion("export const currentSchemaVersion = 1794820000000; // note")
		).to.equal("1794820000000");
		expect(N.schemaVersion("const other = 1;")).to.equal(null);
		expect(N.schemaVersion(undefined)).to.equal(null);
	});
});
