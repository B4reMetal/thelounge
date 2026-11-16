<template>
	<div ref="chat" class="chat" tabindex="-1">
		<div v-show="showLoadMoreButton" class="show-more">
			<button
				ref="loadMoreButton"
				:disabled="channel.historyLoading || !store.state.isConnected"
				class="btn"
				@click="onShowMoreClick"
			>
				<span v-if="channel.historyLoading">Loading…</span>
				<span v-else>Show older messages</span>
			</button>
		</div>
		<div
			class="messages"
			role="log"
			aria-live="polite"
			aria-relevant="additions"
			@copy="onCopy"
		>
			<template v-for="(message, idx) in displayedMessages" :key="getMessageKey(message)">
				<DateMarker
					v-if="shouldDisplayDateMarker(message, idx)"
					:message="message as any"
					:is-focused="isMessageFocused(message)"
				/>
				<div
					v-if="shouldDisplayUnreadMarker(Number(message.id))"
					class="unread-marker"
				>
					<span class="unread-marker-text" />
				</div>

				<MessageCondensed
					v-if="message.type === 'condensed'"
					:network="network"
					:keep-scroll-position="keepScrollPosition"
					:messages="message.messages"
					:is-focused="isMessageFocused(message)"
				/>
				<Message
					v-else
					:channel="channel"
					:network="network"
					:message="message"
					:keep-scroll-position="keepScrollPosition"
					:is-previous-source="isPreviousSource(message, idx)"
					:is-focused="isMessageFocused(message)"
					@toggle-link-preview="onLinkPreviewToggle"
				/>
			</template>
		</div>
		<div v-show="showLoadNewerButton" class="show-more">
			<button
				ref="loadNewerButton"
				:disabled="channel.historySlice?.loadingNewer || !store.state.isConnected"
				class="btn"
				@click="onShowNewerClick"
			>
				<span v-if="channel.historySlice?.loadingNewer">Loading…</span>
				<span v-else>Show newer messages</span>
			</button>
		</div>
	</div>
</template>

<script lang="ts">
import {condensedTypes} from "../../shared/irc";
import {ChanType} from "../../shared/types/chan";
import {MessageType, SharedMsg} from "../../shared/types/msg";
import eventbus from "../js/eventbus";
import clipboard from "../js/clipboard";
import socket from "../js/socket";
import {leaveHistorySlice} from "../js/chan";
import Message from "./Message.vue";
import MessageCondensed from "./MessageCondensed.vue";
import DateMarker from "./DateMarker.vue";
import {
	computed,
	defineComponent,
	nextTick,
	onBeforeUnmount,
	onBeforeUpdate,
	onMounted,
	onUnmounted,
	PropType,
	ref,
	watch,
} from "vue";
import {useStore} from "../js/store";
import {ClientChan, ClientMessage, ClientNetwork, ClientLinkPreview} from "../js/types";

type CondensedMessageContainer = {
	type: "condensed";
	time: Date;
	messages: ClientMessage[];
	id?: number;
};

// TODO: move into component
let unreadMarkerShown = false;

// Render at most this many messages - keeps DOM manageable
const MAX_RENDERED_MESSAGES = 500;

// What a jump is trying to reach: a message id, the time it was sent, or both
type JumpTarget = {id: number | null; time: number | null};

// After a jump the target is kept in place this long while the page settles
const JUMP_HOLD_MS = 1500;

export default defineComponent({
	name: "MessageList",
	components: {
		Message,
		MessageCondensed,
		DateMarker,
	},
	props: {
		network: {type: Object as PropType<ClientNetwork>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
		isFocused: Number,
		focusedTime: Number,
	},
	setup(props) {
		const store = useStore();

		const chat = ref<HTMLDivElement | null>(null);
		const loadMoreButton = ref<HTMLButtonElement | null>(null);
		const loadNewerButton = ref<HTMLButtonElement | null>(null);
		const historyObserver = ref<IntersectionObserver | null>(null);

		// Key (see getMessageKey) of the entry a jump landed on, which is highlighted
		const focusedKey = ref<string | null>(null);

		// True from the moment a jump starts until its target has settled in
		// view. Everything else that moves the scroll position stays out of
		// the way meanwhile.
		const jumping = ref(false);

		// A jump waiting for its target to be fetched from the server
		let pendingJump: JumpTarget | null = null;
		let stopHolding: (() => void) | null = null;

		// Set to handleScroll once that exists further down
		let syncScrollState = () => {};

		// Flag to prevent scroll handler during programmatic scrolls
		const isScrolling = ref(false);

		// Window start index for virtual scrolling - tracks which message index to start from
		const windowStartIndex = ref(0);

		// Track if we're currently adjusting the window (to prevent scroll handler interference)
		const isAdjustingWindow = ref(false);

		// Threshold for triggering window shifts (in pixels from edge)
		const SCROLL_THRESHOLD = 200;

		// Build condensed message list (all messages, before windowing)
		const allCondensedMessages = computed(() => {
			if (props.channel.type !== ChanType.CHANNEL && props.channel.type !== ChanType.QUERY) {
				return props.channel.messages;
			}

			if (store.state.settings.statusMessages === "hidden") {
				return props.channel.messages.filter(
					(message) => !condensedTypes.has(message.type || "")
				);
			}

			if (store.state.settings.statusMessages !== "condensed") {
				return props.channel.messages;
			}

			let lastCondensedContainer: CondensedMessageContainer | null = null;
			const condensed: (ClientMessage | CondensedMessageContainer)[] = [];

			for (const message of props.channel.messages) {
				if (message.self || message.highlight || !condensedTypes.has(message.type || "")) {
					lastCondensedContainer = null;
					condensed.push(message);
					continue;
				}

				if (!lastCondensedContainer) {
					lastCondensedContainer = {
						time: message.time,
						type: "condensed",
						messages: [],
					};
					condensed.push(lastCondensedContainer);
				}

				lastCondensedContainer.messages.push(message);
				lastCondensedContainer.id = message.id;

				if (message.id === props.channel.firstUnread) {
					lastCondensedContainer = null;
				}
			}

			return condensed.map((message) => {
				if (message.type === "condensed" && message.messages.length === 1) {
					return message.messages[0];
				}

				return message;
			});
		});

		// Windowed messages for rendering - show MAX_RENDERED_MESSAGES from windowStartIndex
		// This does NOT depend on scrolledToBottom to avoid reactivity issues
		const displayedMessages = computed(() => {
			const all = allCondensedMessages.value;
			const total = all.length;

			if (total <= MAX_RENDERED_MESSAGES) {
				return all;
			}

			// Use the window start index, clamped to valid range
			const start = Math.max(0, Math.min(windowStartIndex.value, total - MAX_RENDERED_MESSAGES));
			return all.slice(start, start + MAX_RENDERED_MESSAGES);
		});

		// Check if we can scroll further back in the window (not at start of all messages)
		const canScrollBack = computed(() => {
			return windowStartIndex.value > 0;
		});

		// Check if we're showing the latest messages
		const isAtEnd = computed(() => {
			const total = allCondensedMessages.value.length;
			return total <= MAX_RENDERED_MESSAGES ||
				windowStartIndex.value >= total - MAX_RENDERED_MESSAGES;
		});

		// Should we show the "load more" button?
		// Only show when at the start of all loaded messages AND server has more
		const showLoadMoreButton = computed(() => {
			return props.channel.moreHistoryAvailable && windowStartIndex.value === 0;
		});

		// Only while looking at a slice of old history, at the end of what is loaded of it
		const showLoadNewerButton = computed(() => {
			return Boolean(props.channel.historySlice?.hasNewer) && isAtEnd.value;
		});

		// Helper to get a unique key for each message
		const getMessageKey = (message: ClientMessage | CondensedMessageContainer) => {
			if (message.type === "condensed") {
				return `condensed-${message.messages[0]?.id}-${new Date(message.time).getTime()}`;
			}

			// Use time as part of key since IDs can be inconsistent
			return `${message.id}-${new Date(message.time).getTime()}`;
		};

		const isMessageFocused = (message: ClientMessage | CondensedMessageContainer): boolean => {
			return focusedKey.value !== null && getMessageKey(message) === focusedKey.value;
		};

		// Scroll to bottom of the current DOM
		const scrollToBottom = () => {
			if (chat.value) {
				isScrolling.value = true;
				chat.value.scrollTop = chat.value.scrollHeight;

				// Reset after a short delay to allow the scroll event to fire
				setTimeout(() => {
					isScrolling.value = false;
				}, 50);
			}
		};

		const timeOf = (message: {time: Date | string | number}) => new Date(message.time).getTime();

		const requestHistory = (lastId: number) => {
			const oldest = props.channel.messages[0];

			props.channel.historyLoading = true;
			socket.emit("more", {
				target: props.channel.id,
				lastId,
				condensed: store.state.settings.statusMessages !== "shown",
				// Lets the server keep paging from storage once this
				// message is no longer in its memory
				beforeTime: oldest ? timeOf(oldest) : undefined,
			});
		};

		// Jump to the absolute bottom (latest messages) and mark as at bottom
		const jumpToBottom = async () => {
			stopHolding?.();
			pendingJump = null;
			jumping.value = false;
			props.channel.scrolledToBottom = true;

			if (props.channel.historySlice) {
				// The loaded messages are a slice of the past, the latest ones
				// have to come from the server. The list scrolls down by
				// itself once they arrive.
				leaveHistorySlice(props.channel);
				windowStartIndex.value = 0;
				requestHistory(-1);
				return;
			}

			const total = allCondensedMessages.value.length;
			windowStartIndex.value = Math.max(0, total - MAX_RENDERED_MESSAGES);
			isAdjustingWindow.value = true;
			await nextTick();
			scrollToBottom();
			isAdjustingWindow.value = false;
		};

		// Shift window up (show older messages) while preserving scroll position
		const shiftWindowUp = async (amount: number = 100) => {
			if (isAdjustingWindow.value || windowStartIndex.value <= 0) return;

			const el = chat.value;
			if (!el) return;

			isAdjustingWindow.value = true;
			const oldScrollHeight = el.scrollHeight;
			const oldScrollTop = el.scrollTop;

			// Shift window up
			const newStart = Math.max(0, windowStartIndex.value - amount);
			const actualShift = windowStartIndex.value - newStart;

			if (actualShift === 0) {
				isAdjustingWindow.value = false;
				return;
			}

			windowStartIndex.value = newStart;
			props.channel.scrolledToBottom = false;

			await nextTick();

			// Restore scroll position relative to the content that was visible
			const newScrollHeight = el.scrollHeight;
			const heightDiff = newScrollHeight - oldScrollHeight;
			el.scrollTop = oldScrollTop + heightDiff;

			isAdjustingWindow.value = false;
		};

		// Shift window down (show newer messages) while preserving scroll position
		const shiftWindowDown = async (amount: number = 100) => {
			if (isAdjustingWindow.value) return;

			const total = allCondensedMessages.value.length;
			const maxStart = Math.max(0, total - MAX_RENDERED_MESSAGES);
			if (windowStartIndex.value >= maxStart) return;

			const el = chat.value;
			if (!el) return;

			isAdjustingWindow.value = true;
			const oldScrollHeight = el.scrollHeight;
			const oldScrollTop = el.scrollTop;

			// Shift window down
			const newStart = Math.min(maxStart, windowStartIndex.value + amount);
			windowStartIndex.value = newStart;

			// Check if we're now at the end
			if (newStart >= maxStart) {
				props.channel.scrolledToBottom = true;
			}

			await nextTick();

			// Restore scroll position relative to the content that was visible
			const newScrollHeight = el.scrollHeight;
			const heightDiff = oldScrollHeight - newScrollHeight;
			el.scrollTop = oldScrollTop - heightDiff;

			isAdjustingWindow.value = false;
		};

		// Index, in the full list, of the entry that holds the jump target.
		// Id and time together identify a message. An id on its own is only
		// trusted when no time was given: ids restart with the server, so in
		// older history the same id shows up more than once.
		const findTargetIndex = (target: JumpTarget): number => {
			const all = allCondensedMessages.value;
			let sameId = -1;
			let closest = -1;
			let closestDistance = 1000; // time-only targets may be off by under a second

			for (let i = 0; i < all.length; i++) {
				const entry = all[i];
				const inner = entry.type === "condensed" ? entry.messages : [entry];

				for (const message of inner) {
					const time = timeOf(message);

					if (target.id !== null && message.id === target.id) {
						if (target.time === null || time === target.time) {
							return i;
						}

						if (sameId === -1) {
							sameId = i;
						}
					}

					if (target.id === null && target.time !== null) {
						const distance = Math.abs(time - target.time);

						if (distance < closestDistance) {
							closest = i;
							closestDistance = distance;
						}
					}
				}
			}

			if (target.id === null) {
				return closest;
			}

			// Without a time to check against, the id is all there is to go on
			return target.time === null ? sameId : -1;
		};

		// Puts `el` in the middle of the view and keeps it there while the
		// page settles. Late changes in height (previews and images loading,
		// history being added) would otherwise push the target away again
		// right after the jump. Any input from the user ends it at once.
		const holdInView = (el: HTMLElement) => {
			const container = chat.value;

			if (!container) {
				return;
			}

			const center = () => {
				el.scrollIntoView({behavior: "instant", block: "center"});

				// BUGBUG: prevent the chat window offset bugging when scrolling to items near the bottom of the chat
				const outer = container.closest("#chat-container");

				if (outer) {
					outer.scrollTop = 0;
				}
			};

			const userEvents = ["wheel", "touchstart", "mousedown", "keydown"];
			const resizeObserver = new ResizeObserver(center);
			const content = container.querySelector(".messages");

			let timer: ReturnType<typeof setTimeout> | undefined = undefined;

			const stop = () => {
				clearTimeout(timer);
				resizeObserver.disconnect();
				userEvents.forEach((name) => container.removeEventListener(name, stop));
				stopHolding = null;
				jumping.value = false;
				isScrolling.value = false;
				isAdjustingWindow.value = false;

				// Scroll events were ignored meanwhile, catch up with where
				// the view ended up
				syncScrollState();
			};

			timer = setTimeout(stop, JUMP_HOLD_MS);
			userEvents.forEach((name) => container.addEventListener(name, stop, {passive: true}));

			if (content) {
				resizeObserver.observe(content);
			}

			stopHolding = stop;
			isScrolling.value = true;
			center();
		};

		// Scrolls to a message and highlights it. A message that isn't loaded
		// is asked for from the server once (it sends the history around
		// it), and the jump is finished when that arrives.
		const jumpTo = async (target: JumpTarget, mayFetch = true): Promise<boolean> => {
			stopHolding?.();
			pendingJump = null;
			jumping.value = true;
			props.channel.scrolledToBottom = false;

			const index = findTargetIndex(target);

			if (index === -1) {
				if (mayFetch && target.time !== null && store.state.isConnected) {
					pendingJump = target;
					props.channel.historyLoading = true;
					socket.emit("messages:around", {target: props.channel.id, time: target.time});
				} else {
					jumping.value = false;
				}

				return false;
			}

			const all = allCondensedMessages.value;
			const key = getMessageKey(all[index]);
			focusedKey.value = key;
			isAdjustingWindow.value = true;

			// Adjust window to include the target message (center it if possible)
			windowStartIndex.value = Math.max(
				0,
				Math.min(
					index - Math.floor(MAX_RENDERED_MESSAGES / 2),
					all.length - MAX_RENDERED_MESSAGES
				)
			);

			await nextTick();

			// The entry itself, not `#msg-<id>`: a message inside a collapsed
			// group of status messages has no box to scroll to
			const el = chat.value?.querySelector<HTMLElement>(".messages > .msg.is-focused");

			if (!el) {
				focusedKey.value = null;
				jumping.value = false;
				isAdjustingWindow.value = false;
				return false;
			}

			holdInView(el);

			// Clear highlight after a few seconds
			setTimeout(() => {
				if (focusedKey.value === key) {
					focusedKey.value = null;
				}
			}, 3000);

			return true;
		};

		// The message the route asks to be shown, if any
		const routeTarget = (): JumpTarget | null => {
			const id = props.isFocused && !isNaN(props.isFocused) ? props.isFocused : null;
			const time = props.focusedTime && !isNaN(props.focusedTime) ? props.focusedTime : null;

			return id === null && time === null ? null : {id, time};
		};

		// The history around a jump target has arrived, finish the jump
		const onMessagesAround = (chanId: number) => {
			if (chanId !== props.channel.id || !pendingJump) {
				return;
			}

			const target = pendingJump;
			void nextTick().then(() => jumpTo(target, false));
		};

		// Handle scroll events - triggers window shifting when near edges
		const handleScroll = () => {
			// Skip if we're doing a programmatic scroll or adjusting the window
			if (isScrolling.value || isAdjustingWindow.value || jumping.value) {
				return;
			}

			const el = chat.value;
			if (!el) return;

			const scrollTop = el.scrollTop;
			const scrollHeight = el.scrollHeight;
			const clientHeight = el.clientHeight;
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
			const distanceFromTop = scrollTop;

			// Update scrolledToBottom state - only when actually at the DOM bottom AND at end of messages
			const atDOMBottom = distanceFromBottom <= 30;

			// The end of a history slice is not the present
			if (atDOMBottom && isAtEnd.value && !props.channel.historySlice) {
				if (!props.channel.scrolledToBottom) {
					props.channel.scrolledToBottom = true;
				}
			} else if (props.channel.scrolledToBottom && distanceFromBottom > 100) {
				// Only unset if user scrolled significantly away from bottom
				props.channel.scrolledToBottom = false;
			}

			// Dynamic window shifting - shift when user scrolls near edges
			// Shift up (load older) when near top and there are more messages above
			if (distanceFromTop < SCROLL_THRESHOLD && canScrollBack.value) {
				void shiftWindowUp(50);
			}
			// Shift down (load newer) when near bottom but not at end
			else if (distanceFromBottom < SCROLL_THRESHOLD && !isAtEnd.value) {
				void shiftWindowDown(50);
			}
		};

		// Load more from server
		const onShowMoreClick = () => {
			if (!store.state.isConnected) return;

			let lastMessage = -1;

			for (const message of props.channel.messages) {
				if (!message.showInActive) {
					lastMessage = message.id;
					break;
				}
			}

			requestHistory(lastMessage);
		};

		// Extend a slice of old history towards the present
		const onShowNewerClick = () => {
			const slice = props.channel.historySlice;
			const newest = props.channel.messages[props.channel.messages.length - 1];

			if (!slice || slice.loadingNewer || !newest || !store.state.isConnected) {
				return;
			}

			slice.loadingNewer = true;
			// Whatever arrived live up to now is in storage and comes with this page
			slice.liveDropped = false;
			socket.emit("messages:after", {target: props.channel.id, afterTime: timeOf(newest)});
		};

		const shouldDisplayDateMarker = (
			message: SharedMsg | CondensedMessageContainer,
			idx: number
		) => {
			const previousMessage = displayedMessages.value[idx - 1];

			if (!previousMessage) return true;

			const oldDate = new Date(previousMessage.time);
			const newDate = new Date(message.time);

			return (
				oldDate.getDate() !== newDate.getDate() ||
				oldDate.getMonth() !== newDate.getMonth() ||
				oldDate.getFullYear() !== newDate.getFullYear()
			);
		};

		const shouldDisplayUnreadMarker = (id: number) => {
			if (!unreadMarkerShown && id > props.channel.firstUnread) {
				unreadMarkerShown = true;
				return true;
			}

			return false;
		};

		const isPreviousSource = (currentMessage: ClientMessage, idx: number) => {
			const previousMessage = displayedMessages.value[idx - 1];
			return (
				previousMessage &&
				currentMessage.type === MessageType.MESSAGE &&
				previousMessage.type === MessageType.MESSAGE &&
				currentMessage.from &&
				previousMessage.from &&
				currentMessage.from.nick === previousMessage.from.nick
			);
		};

		const onCopy = () => {
			if (chat.value) {
				clipboard(chat.value);
			}
		};

		const keepScrollPosition = async () => {
			if (props.channel.scrolledToBottom) {
				await jumpToBottom();
				return;
			}

			const el = chat.value;
			if (!el) return;

			// Maintain relative scroll position
			isAdjustingWindow.value = true;
			const scrollBottom = el.scrollHeight - el.scrollTop;
			await nextTick();
			isScrolling.value = true;
			el.scrollTop = el.scrollHeight - scrollBottom;
			setTimeout(() => {
				isScrolling.value = false;
				isAdjustingWindow.value = false;
			}, 50);
		};

		const onLinkPreviewToggle = async (preview: ClientLinkPreview, message: ClientMessage) => {
			await keepScrollPosition();
			socket.emit("msg:preview:toggle", {
				target: props.channel.id,
				msgId: message.id,
				link: preview.link,
				shown: preview.shown,
			});
		};

		const handleResize = () => {
			if (props.channel.scrolledToBottom) {
				void jumpToBottom();
			}
		};

		syncScrollState = handleScroll;

		// Presses the "show older" / "show newer" buttons for the user as soon
		// as they scroll into view. A disabled button ignores the press, which
		// is what keeps a page from being requested twice.
		const observeHistoryButtons = () => {
			if (!window.IntersectionObserver || !chat.value) {
				return;
			}

			if (!historyObserver.value) {
				historyObserver.value = new IntersectionObserver(
					(entries) => {
						entries.forEach((entry) => {
							if (entry.isIntersecting) {
								(entry.target as HTMLButtonElement).click();
							}
						});
					},
					{root: chat.value}
				);
			}

			for (const button of [loadMoreButton.value, loadNewerButton.value]) {
				if (button) {
					historyObserver.value.unobserve(button);
					historyObserver.value.observe(button);
				}
			}
		};

		// Initialize
		onMounted(async () => {
			chat.value?.addEventListener("scroll", handleScroll, {passive: true});
			eventbus.on("resize", handleResize);
			eventbus.on("messages:around", onMessagesAround);

			const target = routeTarget();

			if (target) {
				// Handle initial focus from search
				await nextTick();
				await jumpTo(target);
			} else {
				// Default: scroll to bottom
				props.channel.scrolledToBottom = true;
				windowStartIndex.value = Math.max(
					0,
					allCondensedMessages.value.length - MAX_RENDERED_MESSAGES
				);
				await nextTick();
				scrollToBottom();
			}

			// Set up intersection observer for auto-loading history
			await nextTick();
			observeHistoryButtons();
		});

		// Channel switch - scroll to bottom and reset window
		watch(
			() => props.channel.id,
			async () => {
				stopHolding?.();
				pendingJump = null;
				focusedKey.value = null;

				if (routeTarget()) {
					// Switched straight to a message in this channel, the
					// watcher on the route's target takes it from here
					observeHistoryButtons();
					return;
				}

				jumping.value = false;
				props.channel.scrolledToBottom = true;
				windowStartIndex.value = Math.max(
					0,
					allCondensedMessages.value.length - MAX_RENDERED_MESSAGES
				);
				await nextTick();
				scrollToBottom();
				observeHistoryButtons();
			}
		);

		// Track the first message ID to detect when history is loaded
		const firstMessageId = computed(() => {
			const msgs = props.channel.messages;
			return msgs.length > 0 ? msgs[0].id : null;
		});

		// When history is loaded (messages prepended), adjust window to maintain position
		watch(
			firstMessageId,
			async (newFirstId, oldFirstId) => {
				if (oldFirstId === null || newFirstId === null) return;
				if (newFirstId === oldFirstId) return;

				// A jump puts the view where it belongs by itself
				if (jumping.value) return;

				// History was loaded - messages were prepended
				// Adjust windowStartIndex to keep the same messages visible
				const el = chat.value;
				if (!el) return;

				isAdjustingWindow.value = true;
				const oldScrollTop = el.scrollTop;
				const oldScrollHeight = el.scrollHeight;

				// The window start needs to shift by the number of new messages
				// to keep viewing the same content
				const total = allCondensedMessages.value.length;
				const maxStart = Math.max(0, total - MAX_RENDERED_MESSAGES);

				// If we were viewing the oldest loaded messages, keep the window at 0
				// so the user can see the newly loaded history
				if (windowStartIndex.value === 0) {
					// Don't shift - let user see new history
				} else {
					// Shift the window to compensate for new messages
					windowStartIndex.value = Math.min(maxStart, windowStartIndex.value);
				}

				await nextTick();

				// Restore scroll position
				const newScrollHeight = el.scrollHeight;
				const heightDiff = newScrollHeight - oldScrollHeight;
				isScrolling.value = true;
				el.scrollTop = oldScrollTop + heightDiff;

				setTimeout(() => {
					isScrolling.value = false;
					isAdjustingWindow.value = false;
				}, 50);
			}
		);

		// New messages at the end - stay at bottom if we were at bottom
		watch(
			() => props.channel.messages.length,
			async (newLen, oldLen) => {
				if (props.channel.scrolledToBottom) {
					// Keep window at the end when new messages come in
					const total = allCondensedMessages.value.length;
					windowStartIndex.value = Math.max(0, total - MAX_RENDERED_MESSAGES);
					await nextTick();
					scrollToBottom();
				} else if (oldLen !== undefined && newLen > oldLen) {
					// Messages were added (likely at the end) but we're not at bottom
					// Don't change window or scroll - user is reading history
				}
			}
		);

		// Jump to the message the route points at (from search results or mentions)
		watch(
			() => [props.isFocused, props.focusedTime],
			async () => {
				const target = routeTarget();

				if (!target) return;

				await nextTick();
				await jumpTo(target);
			}
		);

		onBeforeUpdate(() => {
			unreadMarkerShown = false;
		});

		onBeforeUnmount(() => {
			stopHolding?.();
			eventbus.off("resize", handleResize);
			eventbus.off("messages:around", onMessagesAround);
			chat.value?.removeEventListener("scroll", handleScroll);
		});

		onUnmounted(() => {
			historyObserver.value?.disconnect();
		});

		return {
			chat,
			store,
			loadMoreButton,
			loadNewerButton,
			showLoadNewerButton,
			onShowNewerClick,
			displayedMessages,
			showLoadMoreButton,
			getMessageKey,
			isMessageFocused,
			onShowMoreClick,
			onCopy,
			shouldDisplayDateMarker,
			shouldDisplayUnreadMarker,
			keepScrollPosition,
			isPreviousSource,
			jumpToBottom,
			onLinkPreviewToggle,
		};
	},
});
</script>
