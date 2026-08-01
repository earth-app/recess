<template>
	<div class="flex flex-col gap-3">
		<div
			data-testid="swipe-hint"
			class="relative h-24 overflow-hidden rounded-2xl"
			:style="{ background: 'var(--ion-background-color-step-100)' }"
			aria-hidden="true"
		>
			<div
				data-testid="swipe-hint-skip"
				class="absolute inset-y-3 left-3 flex w-16 flex-col items-center justify-center gap-1 rounded-xl text-[0.6rem] font-semibold"
				:style="skipStyle"
			>
				<UIcon
					name="mdi:arrow-left"
					class="text-base"
				/>
				{{ t('nudge.notNow') }}
			</div>

			<div
				data-testid="swipe-hint-open"
				class="absolute inset-y-3 right-3 flex w-16 flex-col items-center justify-center gap-1 rounded-xl text-[0.6rem] font-semibold"
				:style="openStyle"
			>
				<UIcon
					name="mdi:arrow-right"
					class="text-base"
				/>
				{{ t('tour.openLabel') }}
			</div>

			<div
				class="track absolute inset-0"
				:class="{ 'motion-off': !animate }"
			>
				<div
					data-testid="swipe-hint-card"
					class="ghost absolute inset-y-2 left-1/2 w-20 -translate-x-1/2 rounded-xl shadow-lg"
					:class="{ 'motion-off': !animate }"
					:style="cardStyle"
				/>
			</div>
		</div>

		<p class="text-sm text-(--ion-text-color-step-300)">{{ t('tour.deckBody') }}</p>
	</div>
</template>

<script setup lang="ts">
import { resolveColor, withAlpha } from '~/utils/color';

const { t } = useI18n();
const { settings } = useAppSettings();

const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const animate = computed(() => settings.value.animations && !reduceMotion.value);

const skipStyle = {
	background: withAlpha('@gray', 0.18),
	color: 'var(--ion-text-color-step-300)'
};

const openStyle = {
	background: withAlpha('@green', 0.2),
	color: resolveColor('@green')
};

const cardStyle = {
	background: `linear-gradient(160deg, ${withAlpha('@blue', 0.9)}, ${withAlpha('@indigo', 0.9)})`
};
</script>

<style scoped>
/**
 * Travel is measured from the container, not the card.
 *
 * `translateX(%)` on the card resolves against the CARD's width, so the swing was a
 * fixed 80px however wide the box got - on the 448px tour sheet that put the card on top
 * of the labels instead of beside them. The track is `inset-0`, so a percentage here is a
 * percentage of the container and the geometry holds at any width.
 *
 * 124px = 12px inset + 64px label + 8px gap + 40px half-card. `max()` keeps the card from
 * swinging backwards if the box is ever narrower than the labels plus the card.
 */
.track {
	--swipe: max(0px, calc(50% - 124px));
	animation: ghost-travel 4.2s ease-in-out infinite;
}

/* rotation rides the card, not the track - on the track it would sweep a huge arc */
.ghost {
	animation: ghost-tilt 4.2s ease-in-out infinite;
}

@keyframes ghost-travel {
	0%,
	8% {
		transform: translateX(0);
	}
	26%,
	34% {
		transform: translateX(var(--swipe));
	}
	48%,
	56% {
		transform: translateX(0);
	}
	74%,
	82% {
		transform: translateX(calc(-1 * var(--swipe)));
	}
	100% {
		transform: translateX(0);
	}
}

@keyframes ghost-tilt {
	0%,
	8% {
		rotate: 0deg;
	}
	26%,
	34% {
		rotate: 7deg;
	}
	48%,
	56% {
		rotate: 0deg;
	}
	74%,
	82% {
		rotate: -7deg;
	}
	100% {
		rotate: 0deg;
	}
}

.motion-off {
	animation: none;
	rotate: 0deg;
}
</style>
