<template>
	<Teleport to="body">
		<div
			v-if="active"
			ref="root"
			data-testid="tour"
			class="pt-safe pb-safe fixed inset-0 z-[10000]"
			role="dialog"
			aria-modal="true"
			:aria-labelledby="TITLE_ID"
			@keydown="onKeydown"
		>
			<div
				class="absolute inset-0 z-0 transition-[clip-path] duration-300"
				:style="scrimStyle"
				@click="skip"
			/>

			<div
				v-if="cutout"
				class="pointer-events-none absolute z-10 rounded-2xl transition-all duration-300"
				:style="ringStyle"
			/>

			<div
				class="pointer-events-auto absolute inset-x-4 z-20 mx-auto flex max-w-md flex-col gap-3 rounded-3xl p-4 shadow-2xl"
				:style="cardStyle"
			>
				<div class="flex items-center gap-2">
					<span class="flex gap-1">
						<span
							v-for="(item, index) in steps"
							:key="item.id"
							class="h-1.5 rounded-full transition-all duration-200"
							:style="dotStyle(index)"
						/>
					</span>
					<span class="ml-auto text-xs tabular-nums text-(--ion-text-color-step-400)">
						{{ step + 1 }} / {{ steps.length }}
					</span>
				</div>

				<h2
					:id="TITLE_ID"
					class="text-lg leading-tight font-semibold"
				>
					{{ current ? t(current.titleKey) : '' }}
				</h2>

				<TourSwipeHint v-if="current?.demo === 'swipe'" />
				<p
					v-else-if="current"
					class="text-sm leading-relaxed text-(--ion-text-color-step-300)"
				>
					{{ t(current.bodyKey) }}
				</p>

				<div class="flex items-center gap-2">
					<IonButton
						ref="skipButton"
						fill="clear"
						size="small"
						color="medium"
						class="text-xs!"
						@click="skip"
					>
						{{ t('tour.skip') }}
					</IonButton>

					<IonButton
						v-if="step > 0"
						fill="clear"
						size="small"
						color="medium"
						class="ml-auto text-xs!"
						@click="back"
					>
						{{ t('common.back') }}
					</IonButton>

					<IonButton
						ref="nextButton"
						size="small"
						color="primary"
						:class="step > 0 ? 'rounded-full! text-xs!' : 'ml-auto rounded-full! text-xs!'"
						@click="next"
					>
						{{ isLast ? t('tour.done') : t('common.next') }}
					</IonButton>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
const { t } = useI18n();
const { active, steps, step, current, isLast, next, back, finish } = useAppTour();

const TITLE_ID = 'recess-tour-title';
/** breathing room around the highlighted element */
const PAD = 8;
/** how far the card sits from the cutout */
const GAP = 14;

interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

const root = ref<HTMLElement | null>(null);
const cutout = ref<Box | null>(null);
const cardTop = ref(0);
const restoreFocus = ref<HTMLElement | null>(null);

const viewport = useWindowSize();

function centreCard() {
	cutout.value = null;
	cardTop.value = Math.max(24, viewport.height.value / 2 - 120);
}

/**
 * Bring the step's target on screen before measuring it.
 *
 * Without this the checklist step - which sits below the fold - was measured off-screen,
 * and the old viewport clamp turned that rect into a box that happened to sit over the
 * deck. So the ring highlighted the wrong element entirely and nothing looked broken.
 */
async function revealTarget(element: Element) {
	const rect = element.getBoundingClientRect();
	const fullyVisible = rect.top >= PAD && rect.bottom <= viewport.height.value - PAD;
	if (fullyVisible) return;

	element.scrollIntoView({ block: 'center', behavior: 'auto' });
	// one frame for the scroll to land, since ion-content scrolls its own container
	await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

async function measure() {
	const target = current.value?.target;
	if (!target) return centreCard();

	const element = document.querySelector(target);
	if (!element) return centreCard();

	await revealTarget(element);

	const rect = element.getBoundingClientRect();
	// no viewport clamp on width/height: clamping distorted the box into something that
	// no longer matched the element. An off-screen target is scrolled to instead
	if (rect.width === 0 || rect.height === 0) return centreCard();

	const box: Box = {
		top: rect.top - PAD,
		left: rect.left - PAD,
		width: rect.width + PAD * 2,
		height: rect.height + PAD * 2
	};
	cutout.value = box;

	const below = box.top + box.height + GAP;
	const wantsAbove = current.value?.placement === 'above';
	// the card is roughly 240px tall with the demo; keep it fully on screen either way
	const estimated = current.value?.demo ? 300 : 220;

	const maxTop = Math.max(24, viewport.height.value - estimated - 24);
	cardTop.value =
		wantsAbove || below + estimated > viewport.height.value
			? Math.min(Math.max(24, box.top - GAP - estimated), maxTop)
			: Math.min(below, maxTop);
}

const scrimStyle = computed(() => {
	const base = 'rgba(4, 8, 14, 0.72)';
	const box = cutout.value;
	if (!box) return { background: base };

	// a clip-path scrim rather than four positioned panels: one element, and the hole
	// animates smoothly between steps
	const { top, left, width, height } = box;
	const right = left + width;
	const bottom = top + height;
	return {
		background: base,
		clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px)`
	};
});

const ringStyle = computed(() => {
	const box = cutout.value;
	if (!box) return {};
	return {
		top: `${box.top}px`,
		left: `${box.left}px`,
		width: `${box.width}px`,
		height: `${box.height}px`,
		boxShadow: '0 0 0 2px var(--ion-color-primary), 0 0 24px rgba(52, 152, 219, 0.45)'
	};
});

const cardStyle = computed(() => ({
	top: `${cardTop.value}px`,
	background: 'var(--ion-background-color-step-50)',
	border: '1px solid var(--ion-background-color-step-150)'
}));

function dotStyle(index: number) {
	const isCurrent = index === step.value;
	return {
		width: isCurrent ? '18px' : '6px',
		background: isCurrent ? 'var(--ion-color-primary)' : 'var(--ion-background-color-step-200)'
	};
}

async function skip() {
	await finish();
}

useEventListener(
	document,
	'keydown',
	(event: KeyboardEvent) => {
		if (!active.value || event.key !== 'Escape') return;
		event.preventDefault();
		void skip();
	},
	{ capture: true }
);

function onKeydown(event: KeyboardEvent) {
	if (event.key !== 'Tab') return;

	// a modal dialog has to keep focus inside it
	const focusable = root.value?.querySelectorAll<HTMLElement>('ion-button');
	if (!focusable || focusable.length === 0) return;

	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (!first || !last) return;

	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}

watch(
	[active, step, () => viewport.width.value, () => viewport.height.value],
	async () => {
		if (!active.value) return;
		// the target may render in the same tick the step changes
		await nextTick();
		await measure();
	},
	{ immediate: true }
);

watch(active, async (open) => {
	if (open) {
		restoreFocus.value = document.activeElement as HTMLElement | null;
		await nextTick();
		root.value?.querySelector<HTMLElement>('ion-button')?.focus();
		return;
	}
	restoreFocus.value?.focus?.();
	restoreFocus.value = null;
});
</script>
