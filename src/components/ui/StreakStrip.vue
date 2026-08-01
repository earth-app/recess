<template>
	<div class="flex w-full flex-col gap-2">
		<div
			v-if="showLetters"
			class="flex items-center gap-1.5"
			aria-hidden="true"
		>
			<span
				v-for="dot in dots"
				:key="`letter-${dot.day}`"
				class="flex-1 text-center text-[0.625rem] leading-none tracking-wide uppercase"
				:class="
					dot.today
						? 'font-bold text-(--ion-text-color)'
						: 'font-medium text-(--ion-text-color-step-400)'
				"
			>
				{{ dot.letter }}
			</span>
		</div>

		<div
			class="flex items-center gap-1.5"
			aria-hidden="true"
		>
			<span
				v-for="dot in dots"
				:key="dot.day"
				class="flex flex-1 justify-center"
			>
				<span
					:class="variant === 'bars' ? 'h-2.5 w-full rounded-full' : 'size-3 rounded-full'"
					:style="dotStyle(dot)"
				/>
			</span>
		</div>

		<span
			v-if="label"
			class="text-xs font-semibold text-(--ion-text-color-step-350)"
		>
			{{ label }}
		</span>
		<span class="sr-only">{{ summary }}</span>
	</div>
</template>

<script setup lang="ts">
import type { StreakDay } from '~/types/context';
import { parseColor, resolveColor, withAlpha } from '~/utils/color';

const props = withDefaults(
	defineProps<{
		days: readonly StreakDay[];
		color?: string;
		label?: string;
		/** dots for a compact row, bars when the strip is the width of a card */
		variant?: 'dots' | 'bars';
		showLetters?: boolean;
		/** the trailing day is today whenever the strip is the live week */
		markToday?: boolean;
	}>(),
	{
		color: 'var(--ion-color-success)',
		variant: 'dots',
		showLetters: true,
		markToday: true
	}
);

const { locale, t } = useI18n();

// day keys are utc, so the letter has to be read back in utc or it slips a day
const letterFormat = computed(
	() => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow', timeZone: 'UTC' })
);

interface Dot extends StreakDay {
	letter: string;
	today: boolean;
}

const dots = computed<Dot[]>(() => {
	const week = props.days.slice(-7);
	return week.map((day, index) => ({
		...day,
		letter: letterFormat.value.format(new Date(day.day)),
		today: props.markToday && index === week.length - 1
	}));
});

// authored tokens (@green, #rrggbb, rgb(...)) resolve; anything else is already css
const dotColor = computed(() =>
	parseColor(props.color) ? resolveColor(props.color) : props.color
);

// withAlpha only understands authored tokens, so a css var falls back to color-mix
const graceFill = computed(() =>
	parseColor(props.color)
		? withAlpha(props.color, 0.35)
		: `color-mix(in srgb, ${props.color} 35%, transparent)`
);

function fillFor(state: StreakDay['state']) {
	switch (state) {
		case 'filled':
			return { background: dotColor.value };
		// a rest day is covered, not missed; ringed rather than marked
		case 'grace':
			return {
				background: graceFill.value,
				boxShadow: `inset 0 0 0 1.5px ${dotColor.value}`
			};
		case 'empty':
			return { background: 'var(--ion-background-color-step-150)' };
		default:
			return { background: 'var(--ion-background-color-step-100)' };
	}
}

function dotStyle(dot: Dot) {
	const fill = fillFor(dot.state);
	if (!dot.today) return fill;
	return {
		...fill,
		outline: '1.5px solid var(--ion-text-color-step-350)',
		outlineOffset: '2px'
	};
}

const counts = computed(() => ({
	filled: dots.value.filter((dot) => dot.state === 'filled').length,
	grace: dots.value.filter((dot) => dot.state === 'grace').length,
	empty: dots.value.filter((dot) => dot.state === 'empty').length,
	future: dots.value.filter((dot) => dot.state === 'future').length
}));

/**
 * The strip's only text. Nine coloured dots say nothing to a screen reader, so this is the whole
 * surface for anyone not looking at it.
 *
 * The count goes in twice on purpose: once named, so it lands in `{count}`, and once as the plural
 * choice. vue-i18n picks the form from the third argument, not from `named.count`, so passing it
 * only as a named value renders both halves of the `|` separated message verbatim.
 */
const summary = computed(() => {
	const { filled, grace, empty, future } = counts.value;

	const parts: string[] = [];
	if (filled > 0) parts.push(t('today.stripDone', { count: filled }, filled));
	if (grace > 0) parts.push(t('today.stripRest', { count: grace }, grace));
	if (empty > 0) parts.push(t('today.stripQuiet', { count: empty }, empty));
	if (future > 0) parts.push(t('today.stripAhead', { count: future }, future));

	if (parts.length === 0) return t('today.stripEmpty');
	return t('today.strip', { count: dots.value.length, parts: parts.join(', ') });
});
</script>
