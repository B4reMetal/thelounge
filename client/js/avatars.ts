import socket from "./socket";
import {store} from "./store";

/**
 * Tracker avatars (see server/plugins/avatars.ts).
 *
 * 1. Shows cached avatars: one CSS rule per nick sets `--tl-avatar` on that
 *    nick's `.user` elements, only inside channels of networks of that tracker.
 *    Themes use it as the avatar image (the default theme ignores it).
 * 2. Relays fetch jobs to the avatar userscript, when one is installed. The
 *    userscript fetches with the browser's tracker login, which the page itself
 *    can't do. Page and userscript talk through window events with JSON
 *    strings, which cross the userscript sandbox safely:
 *      page → "tl-avatar-fetcher-ping"
 *      userscript → "tl-avatar-fetcher-ready"  {hosts: string[]}
 *      page → "tl-avatar-fetch"                {id, url, ifModifiedSince?}
 *      userscript → "tl-avatar-result"         {id, status, contentType, lastModified, finalUrl, dataUrl?}
 * 3. Clicking a nick asks the server to look it up first.
 */

const avatars = new Map<string, string>(); // `${tracker}:${nick lowercased}` → url

const style = document.createElement("style");
style.id = "tl-avatars";
document.head.appendChild(style);

const cssString = (s: string) =>
	s.replace(/["\\\n\r]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ");

let renderQueued = false;

function render() {
	if (renderQueued) {
		return;
	}

	renderQueued = true;
	requestAnimationFrame(() => {
		renderQueued = false;

		// Chat views (#chan-<id>) of the networks each tracker's users chat on
		const views = new Map<string, string[]>();

		for (const network of store.state.networks) {
			for (const tracker of network.trackers || []) {
				if (!tracker.avatars) {
					continue;
				}

				const list = views.get(tracker.id) || [];
				list.push(...network.channels.map((c) => `#chan-${c.id}`));
				views.set(tracker.id, list);
			}
		}

		let css = "";

		for (const [key, url] of avatars) {
			const sep = key.indexOf(":");
			const ids = views.get(key.slice(0, sep));

			if (!ids || ids.length === 0) {
				continue;
			}

			// Absolute: a relative url() in a custom property resolves against the stylesheet
			// that uses it (the theme's), not this page
			const absolute = new URL(url, document.baseURI).href;
			css += `:is(${ids.join(",")}) .user[data-name="${cssString(key.slice(sep + 1))}" i]{--tl-avatar:url("${cssString(absolute)}")}\n`;
		}

		style.textContent = css;
	});
}

socket.on("init", () => {
	// The server sends the full list again after init
	avatars.clear();
	offerFetcher();
});

socket.on("avatars:update", (updates) => {
	if (!Array.isArray(updates)) {
		return;
	}

	for (const u of updates) {
		if (!u || typeof u.tracker !== "string" || typeof u.nick !== "string") {
			continue;
		}

		const key = `${u.tracker}:${u.nick.toLowerCase()}`;

		if (
			typeof u.url === "string" &&
			/^avatars\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(u.url)
		) {
			avatars.set(key, u.url);
		} else {
			avatars.delete(key);
		}
	}

	render();
});

// Re-render when networks, their trackers or their channels change
store.watch(
	(state) =>
		state.networks
			.map(
				(n) =>
					`${(n.trackers || [])
						.filter((t) => t.avatars)
						.map((t) => t.id)
						.join(",")}:${n.channels.map((c) => c.id).join(",")}`
			)
			.join("|"),
	render
);

// --- Fetcher bridge to the avatar userscript ---

let fetcherHosts: string[] | null = null;
const pendingJobs = new Map<string, (result: Record<string, unknown>) => void>();

function offerFetcher() {
	if (fetcherHosts && socket.connected) {
		socket.emit("avatars:fetcher", {hosts: fetcherHosts});
	}
}

function parseDetail(e: Event): Record<string, unknown> | null {
	try {
		const detail = (e as CustomEvent<unknown>).detail;
		const parsed: unknown = typeof detail === "string" ? JSON.parse(detail) : null;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

window.addEventListener("tl-avatar-fetcher-ready", (e) => {
	const d = parseDetail(e);

	if (d && Array.isArray(d.hosts)) {
		fetcherHosts = d.hosts.filter((h): h is string => typeof h === "string").slice(0, 16);
		offerFetcher();
	}
});

window.addEventListener("tl-avatar-result", (e) => {
	const d = parseDetail(e);

	if (d && typeof d.id === "string") {
		pendingJobs.get(d.id)?.(d);
	}
});

// In case the userscript loaded first
window.dispatchEvent(new CustomEvent("tl-avatar-fetcher-ping"));

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | undefined {
	const comma = dataUrl.indexOf(",");

	if (!dataUrl.startsWith("data:") || comma < 0 || !dataUrl.slice(0, comma).endsWith(";base64")) {
		return undefined;
	}

	const bin = atob(dataUrl.slice(comma + 1));
	const bytes = new Uint8Array(bin.length);

	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i);
	}

	return bytes.buffer;
}

socket.on("avatars:fetch", async (job) => {
	if (!fetcherHosts || !job || typeof job.id !== "string" || typeof job.url !== "string") {
		return;
	}

	const result = await new Promise<Record<string, unknown>>((resolve) => {
		const timer = setTimeout(() => resolve({status: 0}), 45000);
		pendingJobs.set(job.id, (r) => {
			clearTimeout(timer);
			resolve(r);
		});
		window.dispatchEvent(
			new CustomEvent("tl-avatar-fetch", {
				detail: JSON.stringify({
					id: job.id,
					url: job.url,
					ifModifiedSince: job.ifModifiedSince,
				}),
			})
		);
	});
	pendingJobs.delete(job.id);

	const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 2048) : undefined);
	const dataUrl = typeof result.dataUrl === "string" ? result.dataUrl : "";

	socket.emit("avatars:result", {
		id: job.id,
		status: Number(result.status) || 0,
		contentType: str(result.contentType),
		lastModified: str(result.lastModified),
		finalUrl: str(result.finalUrl),
		data: dataUrl ? dataUrlToArrayBuffer(dataUrl) : undefined,
	});
});

// --- Clicking a nick: look it up first ---

document.addEventListener(
	"click",
	(e) => {
		const user =
			e.target instanceof Element ? e.target.closest<HTMLElement>(".user[data-name]") : null;
		const view = user?.closest(".chat-view");

		if (!user || !view) {
			return;
		}

		const found = store.getters.findChannel(Number(view.id.replace("chan-", "")));

		if (!found || !(found.network.trackers || []).some((t) => t.avatars)) {
			return;
		}

		socket.emit("avatars:want", {
			network: found.network.uuid,
			nick: user.dataset.name || "",
			channel: found.channel.name,
		});
	},
	true
);
