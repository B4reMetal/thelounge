<template>
	<span class="emoji-picker-wrap">
		<button
			id="emoji"
			ref="toggleButton"
			type="button"
			aria-label="Pick an emoji"
			title="Emoji"
			:aria-expanded="open ? 'true' : 'false'"
			@click="toggle"
		/>
		<div
			v-if="open"
			ref="panel"
			class="emoji-picker"
			role="dialog"
			aria-label="Emoji picker"
			@keydown.esc.stop.prevent="close(true)"
		>
			<input
				ref="searchInput"
				v-model="search"
				type="search"
				class="emoji-picker-search input"
				placeholder="Find the perfect emoji"
				aria-label="Search emoji"
				@keydown.enter.prevent="pickFirst"
			/>
			<nav v-if="!search" class="emoji-picker-tabs" aria-label="Emoji categories">
				<button
					v-for="group in groups"
					:key="group.id"
					type="button"
					class="emoji-picker-tab"
					:title="group.label"
					:aria-label="group.label"
					@click="scrollTo(group.id)"
				>
					{{ group.icon }}
				</button>
			</nav>
			<div ref="grid" class="emoji-picker-grid" @mouseleave="hovered = null">
				<template v-for="group in shownGroups" :key="group.id">
					<div :data-group="group.id" class="emoji-picker-group">{{ group.label }}</div>
					<div class="emoji-picker-items">
						<button
							v-for="item in group.items"
							:key="group.id + item.name"
							type="button"
							class="emoji-picker-item"
							:title="`:${item.name}:`"
							:aria-label="item.name.replace(/_/g, ' ')"
							@mouseenter="hovered = item"
							@click="pick(item, $event)"
						>
							{{ item.emoji }}
						</button>
					</div>
				</template>
				<p v-if="shownGroups.length === 0" class="emoji-picker-empty">
					No emoji match “{{ search }}”.
				</p>
			</div>
			<div class="emoji-picker-footer">
				<template v-if="hovered">
					<span class="emoji-picker-preview">{{ hovered.emoji }}</span>
					<span class="emoji-picker-name">:{{ hovered.name }}:</span>
				</template>
				<span v-else class="emoji-picker-hint">Shift-click to pick several</span>
			</div>
		</div>
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, nextTick, onBeforeUnmount, ref} from "vue";
import emojiMap from "../js/helpers/simplemap.json" with {type: "json"};
import storage from "../js/localStorage";

type Item = {name: string; emoji: string};

// simplemap.json follows Unicode's emoji order, so categories start at these
const categories = [
	{id: "people", label: "Smileys & People", start: "grinning", icon: "😀"},
	{id: "nature", label: "Animals & Nature", start: "monkey_face", icon: "🐵"},
	{id: "food", label: "Food & Drink", start: "grapes", icon: "🍇"},
	{id: "travel", label: "Travel & Places", start: "earth_africa", icon: "🌍"},
	{id: "activities", label: "Activities", start: "jack_o_lantern", icon: "🎃"},
	{id: "objects", label: "Objects", start: "eyeglasses", icon: "👓"},
	{id: "symbols", label: "Symbols", start: "atm", icon: "🏧"},
	{id: "flags", label: "Flags", start: "checkered_flag", icon: "🏁"},
];

const map = emojiMap as Record<string, string>;
const names = Object.keys(map);

// One entry per emoji (the map has aliases), grouped by category
const allGroups = categories.map((cat, i) => {
	const from = names.indexOf(cat.start);
	const next = categories[i + 1];
	const to = next ? names.indexOf(next.start) : names.length;
	return {...cat, names: names.slice(from, to)};
});
// Anything before the first category (e.g. :100:) is a symbol
allGroups[6].names.unshift(...names.slice(0, names.indexOf(categories[0].start)));

const seen = new Set<string>();
const groupsData = allGroups.map((g) => ({
	id: g.id,
	label: g.label,
	icon: g.icon,
	items: g.names
		.filter((n) => !seen.has(map[n]) && seen.add(map[n]))
		.map((name) => ({name, emoji: map[name]})),
}));

const recentKey = "emojiRecent";
const maxRecent = 24;

function loadRecent(): string[] {
	try {
		const parsed: unknown = JSON.parse(storage.get(recentKey) || "[]");
		return Array.isArray(parsed)
			? parsed.filter((n): n is string => typeof n === "string" && n in map)
			: [];
	} catch {
		return [];
	}
}

export default defineComponent({
	name: "EmojiPicker",
	emits: ["pick"],
	setup(_props, {emit}) {
		const open = ref(false);
		const search = ref("");
		const hovered = ref<Item | null>(null);
		const recent = ref<string[]>(loadRecent());
		const panel = ref<HTMLElement | null>(null);
		const grid = ref<HTMLElement | null>(null);
		const searchInput = ref<HTMLInputElement | null>(null);
		const toggleButton = ref<HTMLButtonElement | null>(null);

		const groups = computed(() => [
			...(recent.value.length
				? [
						{
							id: "recent",
							label: "Frequently used",
							icon: "🕘",
							items: recent.value.map((name) => ({name, emoji: map[name]})),
						},
					]
				: []),
			...groupsData,
		]);

		const shownGroups = computed(() => {
			const needle = search.value.trim().toLowerCase().replace(/^:|:$/g, "");

			if (!needle) {
				return groups.value;
			}

			// Search every name, aliases included
			const hits = names
				.filter((n) => n.includes(needle))
				.sort((a, b) => Number(!a.startsWith(needle)) - Number(!b.startsWith(needle)));
			const unique = new Map<string, Item>();

			for (const name of hits) {
				if (!unique.has(map[name])) {
					unique.set(map[name], {name, emoji: map[name]});
				}
			}

			return unique.size
				? [{id: "search", label: "Results", icon: "", items: [...unique.values()]}]
				: [];
		});

		// Function declarations: closing removes the outside-click listener and vice versa
		function close(refocus: boolean) {
			open.value = false;
			search.value = "";
			document.removeEventListener("mousedown", onOutside, true);

			if (refocus) {
				document.getElementById("input")?.focus();
			}
		}

		function onOutside(e: MouseEvent) {
			const target = e.target as Node;

			if (!panel.value?.contains(target) && !toggleButton.value?.contains(target)) {
				close(false);
			}
		}

		const toggle = () => {
			if (open.value) {
				close(true);
				return;
			}

			open.value = true;
			document.addEventListener("mousedown", onOutside, true);
			void nextTick(() => searchInput.value?.focus());
		};

		const remember = (name: string) => {
			recent.value = [name, ...recent.value.filter((n) => n !== name)].slice(0, maxRecent);
			storage.set(recentKey, JSON.stringify(recent.value));
		};

		const pick = (item: Item, e?: MouseEvent) => {
			remember(item.name);
			emit("pick", item.emoji);

			if (!e?.shiftKey) {
				close(true);
			}
		};

		const pickFirst = () => {
			const first = shownGroups.value[0]?.items[0];

			if (first) {
				pick(first);
			}
		};

		const scrollTo = (id: string) => {
			const header = grid.value?.querySelector<HTMLElement>(`[data-group="${id}"]`);

			if (header && grid.value) {
				grid.value.scrollTop = header.offsetTop - grid.value.offsetTop;
			}
		};

		onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside, true));

		return {
			open,
			search,
			hovered,
			groups,
			shownGroups,
			panel,
			grid,
			searchInput,
			toggleButton,
			toggle,
			close,
			pick,
			pickFirst,
			scrollTo,
		};
	},
});
</script>
