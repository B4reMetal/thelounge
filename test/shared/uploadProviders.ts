import {expect} from "chai";
import sinon from "sinon";
import {UploadProviders} from "../../shared/upload-providers.js";

describe("UploadProviders", function () {
	describe("rustypaste", function () {
		const provider = UploadProviders.find((p) => p.id === "rustypaste")!;
		const serverUrl = "https://paste.example.com/";
		const file = new File(["hello"], "hello.txt", {type: "text/plain"});
		let fetchStub: sinon.SinonStub;

		const urlToken = (token = "") => `${btoa(serverUrl)}_|_${token}`;

		beforeEach(function () {
			fetchStub = sinon.stub(globalThis, "fetch");
		});

		afterEach(function () {
			fetchStub.restore();
		});

		it("should be registered as a self-hosted provider", function () {
			expect(provider).to.not.equal(undefined);
			expect(provider.requiresURL).to.equal(true);
			expect(provider.validTtl?.find((t) => t.default)?.id).to.equal("default");
		});

		it("should upload the file and return the first url from the response", async function () {
			fetchStub.resolves(new Response("https://paste.example.com/hello.txt\n"));

			const url = await provider.upload(file, "1day", urlToken("secret"));

			expect(url).to.equal("https://paste.example.com/hello.txt");
			expect(fetchStub.calledOnce).to.equal(true);

			const [requestUrl, init] = fetchStub.firstCall.args;
			expect(requestUrl).to.equal(serverUrl);
			expect(init.method).to.equal("POST");
			expect(init.headers).to.deep.equal({
				authorization: "Bearer secret",
				expire: "1d",
			});
			expect((init.body as FormData).get("file")).to.be.instanceOf(File);
		});

		it("should omit auth and expire headers when not needed", async function () {
			fetchStub.resolves(new Response("https://paste.example.com/hello.txt\n"));

			await provider.upload(file, "default", urlToken());

			expect(fetchStub.firstCall.args[1].headers).to.deep.equal({});
		});

		it("should surface the server error message", async function () {
			fetchStub.resolves(new Response("unauthorized\n", {status: 401}));

			let error: unknown;

			try {
				await provider.upload(file, "default", urlToken("wrong"));
			} catch (e) {
				error = e;
			}

			expect(error).to.be.instanceOf(Error);
			expect((error as Error).message).to.equal("unauthorized");
		});

		it("should reject an invalid upload url", async function () {
			let error: unknown;

			try {
				await provider.upload(file, "default", `${btoa("ftp://nope")}_|_`);
			} catch (e) {
				error = e;
			}

			expect((error as Error).message).to.equal("Invalid Upload URL");
			expect(fetchStub.called).to.equal(false);
		});
	});
});
