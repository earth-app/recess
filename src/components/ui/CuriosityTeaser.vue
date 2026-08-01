<template>
	<span
		v-if="gap.teaser"
		class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
		:style="pillStyle"
	>
		<UIcon
			:name="pillIcon"
			class="size-3.5"
			:class="pulse"
		/>
		<span>{{ gap.teaser }}</span>
	</span>
</template>

<script lang="ts">
export interface CuriosityGap {
	revealed: number;
	total: number;
	remaining: number;
	/** everything is already revealed */
	complete: boolean;
	/** exactly one left; the strongest pull, so it gets its own copy */
	oneAway: boolean;
	/** 0..1 progress toward fully revealed */
	pct: number;
	/** Title Case teaser line; empty string when there is nothing to tease */
	teaser: string;
}

function titleCase(text: string): string {
	return text.replace(
		/(^|[\s-])([a-z])/g,
		(_match: string, lead: string, char: string) => lead + char.toUpperCase()
	);
}

function singularOf(noun: string): string {
	if (/ies$/i.test(noun)) return noun.replace(/ies$/i, 'y');
	if (/(s|x|z|ch|sh)es$/i.test(noun)) return noun.replace(/es$/i, '');
	if (/[^s]s$/i.test(noun)) return noun.slice(0, -1);
	return noun;
}

function pluralOf(noun: string): string {
	const singular = singularOf(noun);
	if (/y$/i.test(singular)) return singular.replace(/y$/i, 'ies');
	if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`;
	return `${singular}s`;
}

/**
 * how much is left to discover, plus the copy for it. pure so the wording can be
 * unit tested without mounting the component.
 */
export function curiosityGap(revealed: number, total: number, noun = 'nudges'): CuriosityGap {
	const word = noun.trim() || 'nudges';
	const tot = Math.max(0, Math.floor(total || 0));
	const rev = Math.min(tot, Math.max(0, Math.floor(revealed || 0)));
	const remaining = Math.max(0, tot - rev);
	const complete = tot > 0 && rev >= tot;
	const oneAway = remaining === 1;
	const pct = tot > 0 ? rev / tot : 0;

	const plural = titleCase(pluralOf(word));
	let teaser = '';
	if (tot === 0) teaser = '';
	else if (complete) teaser = 'All Done';
	else if (oneAway) teaser = `One ${titleCase(singularOf(word))} Away`;
	else if (rev === 0) teaser = `${tot} ${plural} Waiting`;
	else teaser = `${remaining} ${plural} to Go`;

	return { revealed: rev, total: tot, remaining, complete, oneAway, pct, teaser };
}
</script>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		revealed: number;
		total: number;
		noun?: string;
		icon?: string;
	}>(),
	{ noun: 'nudges', icon: 'mdi:help-circle-outline' }
);

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const settings = useAppSettingsState();

const gap = computed(() => curiosityGap(props.revealed, props.total, props.noun));

const pillIcon = computed(() => (gap.value.complete ? 'mdi:check-circle-outline' : props.icon));

// a raw accent on an accent tint is unreadable for the pale tokens (@gold sits at
// 1.2:1), so the ink is pulled toward whatever the page's text colour is
const INK = 'color-mix(in srgb, var(--nudge-accent) 55%, var(--ion-text-color))';

const pillStyle = computed(() => {
	if (gap.value.complete) {
		return { background: 'var(--nudge-accent)', color: 'var(--nudge-on-accent, #ffffff)' };
	}
	// the last one left gets an outline instead of a louder color
	if (gap.value.oneAway) {
		return {
			background: 'var(--nudge-accent-soft)',
			color: INK,
			boxShadow: 'inset 0 0 0 1px var(--nudge-accent)'
		};
	}
	return { background: 'var(--nudge-accent-soft)', color: INK };
});

const pulse = computed(() =>
	gap.value.oneAway && !prefersReducedMotion.value && settings.value.animations
		? 'motion-safe:animate-pulse'
		: ''
);
</script>
