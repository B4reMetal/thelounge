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

// Initials first, avatars after: an avatar rule also clears the initials
const initialsStyle = document.createElement("style");
initialsStyle.id = "tl-initials";
document.head.appendChild(initialsStyle);

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

		// Where each tracker's avatars apply: the chat views (#chan-<id>) of its
		// networks, and those networks' private-message rows in the sidebar
		const views = new Map<string, string[]>();
		const sidebars = new Map<string, string[]>();
		const netUuids = new Map<string, string[]>(); // [data-network="…"] per tracker

		for (const network of store.state.networks) {
			for (const tracker of network.trackers || []) {
				if (!tracker.avatars) {
					continue;
				}

				views.set(tracker.id, [
					...(views.get(tracker.id) || []),
					...network.channels.map((c) => `#chan-${c.id}`),
				]);
				netUuids.set(tracker.id, [
					...(netUuids.get(tracker.id) || []),
					`[data-network="${cssString(network.uuid)}"]`,
				]);
				sidebars.set(tracker.id, [
					...(sidebars.get(tracker.id) || []),
					`#network-${CSS.escape(network.uuid)}`,
					`.home-dm-row[data-network="${cssString(network.uuid)}"]`,
				]);
			}
		}

		let css = "";

		for (const [key, url] of avatars) {
			const sep = key.indexOf(":");
			const tracker = key.slice(0, sep);
			const ids = views.get(tracker);
			const nets = sidebars.get(tracker);

			if (!ids || !nets) {
				continue;
			}

			const nick = cssString(key.slice(sep + 1));

			// Absolute: a relative url() in a custom property resolves against the stylesheet
			// that uses it (the theme's), not this page
			const absolute = new URL(url, document.baseURI).href;
			const selectors = [
				...(ids.length
					? [
							`:is(${ids.join(",")}) .user[data-name="${nick}" i]`,
							`:is(${ids.join(",")}) .header[data-name="${nick}" i]`,
						]
					: []),
				`:is(${nets.join(",")}) .channel-list-item[data-type="query"][data-name="${nick}" i]`,
				`.footer-identity:is(${netUuids.get(tracker)!.join(",")})[data-name="${nick}" i]`,
			];
			css += `${selectors.join(",")}{--tl-avatar:url("${cssString(absolute)}");--tl-initials:""}\n`;
		}

		style.textContent = css;
	});
}

// --- Initials for names without an avatar: BareMetal → BM, sable → S ---

export function initialsFor(nick: string): string {
	const words = nick
		.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2") // camelCase → camel Case
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
	const letters = words.map((w) => w[0]).join("");
	return (letters || nick.slice(0, 1)).slice(0, 2).toUpperCase();
}

const knownNames = new Set<string>();
let initialsQueued = false;

function scanNames() {
	initialsQueued = false;
	let added = false;

	for (const el of document.querySelectorAll<HTMLElement>(
		'.user[data-name], .channel-list-item[data-type="query"][data-name], .footer-identity[data-name], .header[data-name]'
	)) {
		const name = el.dataset.name;

		if (name && !knownNames.has(name.toLowerCase())) {
			knownNames.add(name.toLowerCase());
			added = true;
		}
	}

	if (!added) {
		return;
	}

	let css = "";

	for (const name of knownNames) {
		const n = cssString(name);
		css += `.user[data-name="${n}" i],.channel-list-item[data-type="query"][data-name="${n}" i],.footer-identity[data-name="${n}" i],.header[data-name="${n}" i]{--tl-initials:"${cssString(initialsFor(name))}"}\n`;
	}

	initialsStyle.textContent = css;
}

new MutationObserver(() => {
	if (!initialsQueued) {
		initialsQueued = true;
		setTimeout(scanNames, 300);
	}
}).observe(document.body, {childList: true, subtree: true});

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
