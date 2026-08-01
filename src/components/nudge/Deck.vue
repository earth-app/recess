<template>
	<div
		ref="frame"
		class="relative mx-auto w-full max-w-md"
		data-testid="deck-frame"
		:style="{ height: `${height}px` }"
	>
		<TransitionGroup name="deck">
			<div
				v-for="(nudge, index) in visible"
				:key="nudge.id"
				class="absolute inset-0 origin-bottom"
				:style="cardStyle(index)"
				:aria-hidden="index > 0"
			>
				<div
					v-if="index === 0"
					class="h-full touch-none"
					role="button"
					:aria-label="`${t('today.openNudge')}: ${nudgeTitle(nudge)}`"
					@pointerdown="onDown"
					@pointermove="onMove"
					@pointerup="onUp"
					@pointercancel="onUp"
				>
					<NudgeCard :nudge="nudge" />
				</div>
				<div
					v-else
					class="nudge-back h-full w-full rounded-3xl shadow-lg"
					:style="backStyle(nudge)"
				/>
			</div>
		</TransitionGroup>

		<div
			v-if="drag.active && Math.abs(drag.dx) > HINT_AT"
			class="pointer-events-none absolute inset-x-0 top-6 flex justify-center"
		>
			<span
				class="rounded-full px-4 py-2 text-sm font-semibold shadow-lg"
				:class="drag.dx < 0 ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-900'"
			>
				{{ drag.dx < 0 ? t('nudge.notNow') : t('today.openNudge') }}
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Nudge } from '~/types/nudge';
import { nudgeTitle } from '~/types/nudge';
import { nudgeColorVars } from '~/utils/color';

const props = defineProps<{ nudges: Nudge[] }>();
const emit = defineEmits<{ open: [Nudge]; skip: [Nudge] }>();

const { t } = useI18n();
const { swipe } = useHaptics();

export interface DeckDrag {
	active: boolean;
	dx: number;
	dy: number;
}

const VISIBLE_CARDS = 3;
/** past this the intent is unambiguous, so show which way it will go */
const HINT_AT = 40;
/** past this on release, the card leaves */
const COMMIT_AT = 110;

/**
 * Below this a card cannot hold four lines of copy plus its header and points pill, so the
 * deck keeps the height and the page scrolls instead. Above it a card stops reading as a
 * card and starts reading as a panel.
 */
const MIN_HEIGHT = 300;
const MAX_HEIGHT = 440;

const drag = reactive<DeckDrag>({ active: false, dx: 0, dy: 0 });
let pointerId: number | null = null;
let startX = 0;
let startY = 0;

const visible = computed(() => props.nudges.slice(0, VISIBLE_CARDS));

/**
 * Measured, not a constant.
 *
 * A flat 420px was 40px taller than the room between the deck and the tab bar on a Pixel 7,
 * so the front card's bottom edge and its points pill sat behind the bar before the user had
 * scrolled anything. A fixed height cannot know what is above it, and the ring card above
 * the deck grows with the text-size setting (0.7x-1.5x), which moves the deck's top by 180px
 * between the extremes - so the clipping got worse the larger someone set their type.
 *
 * A viewport-relative `dvh` clamp was tried first and is no better: it is blind to the text
 * scale too. At 667px with 1.5x type only 28px of room is left, so no height fits there and
 * the honest answer is to keep the minimum and let the page scroll.
 */
const frame = useTemplateRef<HTMLElement>('frame');
const height = ref(MIN_HEIGHT);

function measure() {
	const el = frame.value;
	const bar = document.querySelector('ion-tab-bar');
	if (!el || !bar) return;

	// scrollTop is added back so the answer is the same whether or not the page is scrolled
	const scroller = el.closest('ion-content')?.shadowRoot?.querySelector('.inner-scroll');
	const scrolled = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
	const top = el.getBoundingClientRect().top + scrolled;

	/**
	 * The tap/swipe hint below the deck is part of the deck's affordance, so its height is
	 * reserved rather than consumed. Taking the whole gap to the tab bar pushed that row
	 * underneath it, where it stayed in the accessibility tree overlapping the Playground tab
	 * and swallowed the taps meant for it - only a Maestro run showed that, because it taps
	 * screen coordinates while Playwright clicks an element directly.
	 *
	 * Found by `[data-deck-hint]`, not by `nextElementSibling`: the hint is a sibling of the
	 * deck's *wrapper*, so walking siblings from here finds nothing and reserves zero. Measured
	 * rather than hardcoded, so it follows the text-size setting like everything else.
	 */
	const hint = document.querySelector('[data-deck-hint]');
	// the gap belongs to the hint's own flex parent; the frame's parent is a bare tour wrapper
	// with no gap of its own, and reading it there left the reserve exactly one gap short
	const gap = hint?.parentElement
		? Number.parseFloat(getComputedStyle(hint.parentElement).rowGap) || 0
		: 0;
	const reserve = hint instanceof HTMLElement ? hint.getBoundingClientRect().height + gap : 0;

	const available = bar.getBoundingClientRect().top - top - reserve;

	height.value = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, available)));
}

onMounted(() => {
	requestAnimationFrame(measure);

	// catches rotation, the text-size setting, and the ring card growing as the day fills
	const observer = new ResizeObserver(() => measure());
	observer.observe(document.body);
	onBeforeUnmount(() => observer.disconnect());
});

/**
 * The back of the deck carries no copy.
 *
 * Rendering a full card behind the front one stacked three titles, three icon tiles
 * and three point pills within 12px of each other; any translucency in the front
 * card - and there was some - made all of it legible at once.
 */
function backStyle(nudge: Nudge) {
	const vars = nudgeColorVars(nudge.color);
	return {
		...vars,
		background: `linear-gradient(160deg, ${vars['--nudge-accent-soft']} 0%, var(--ion-background-color) 60%)`,
		border: `1px solid ${vars['--nudge-accent-soft']}`
	};
}

function cardStyle(index: number) {
	if (index > 0) {
		// scaled from the bottom edge so each back card peeks out below the front one
		return {
			transform: `translateY(${index * 14}px) scale(${1 - index * 0.05})`,
			zIndex: String(VISIBLE_CARDS - index),
			transition: drag.active ? 'none' : 'transform 260ms ease, opacity 260ms ease'
		};
	}

	const rotation = drag.dx / 22;
	return {
		transform: `translate(${drag.dx}px, ${drag.dy * 0.35}px) rotate(${rotation}deg)`,
		zIndex: String(VISIBLE_CARDS + 1),
		transition: drag.active ? 'none' : 'transform 260ms cubic-bezier(0.2, 0, 0.2, 1)'
	};
}

function onDown(event: PointerEvent) {
	if (pointerId !== null) return;
	pointerId = event.pointerId;
	startX = event.clientX;
	startY = event.clientY;
	drag.active = true;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onMove(event: PointerEvent) {
	if (!drag.active || event.pointerId !== pointerId) return;
	drag.dx = event.clientX - startX;
	drag.dy = event.clientY - startY;
}

function onUp(event: PointerEvent) {
	if (!drag.active || event.pointerId !== pointerId) return;

	const dx = drag.dx;
	const moved = Math.abs(dx) + Math.abs(drag.dy);
	const current = visible.value[0];

	pointerId = null;
	drag.active = false;
	drag.dx = 0;
	drag.dy = 0;

	if (!current) return;

	if (dx <= -COMMIT_AT) {
		swipe();
		emit('skip', current);
		return;
	}

	if (dx >= COMMIT_AT) {
		swipe();
		emit('open', current);
		return;
	}

	// a tap, not a drag
	if (moved < 8) emit('open', current);
}
</script>

<style scoped>
.deck-leave-active {
	transition:
		transform 300ms ease,
		opacity 300ms ease;
	position: absolute;
	inset: 0;
}

.deck-leave-to {
	opacity: 0;
	transform: translateY(-40px) scale(0.9);
}

.deck-enter-active {
	transition:
		transform 300ms ease,
		opacity 300ms ease;
}

.deck-enter-from {
	opacity: 0;
	transform: translateY(24px) scale(0.96);
}
</style>
