<template>
	<IonPage>
		<IonTabs>
			<IonRouterOutlet :animation="slide" />

			<IonTabBar
				slot="bottom"
				:style="barStyle"
			>
				<IonTabButton
					v-for="tab in tabs"
					:key="tab.tab"
					:tab="tab.tab"
					:href="tab.href"
				>
					<UIcon
						:name="tab.icon"
						class="text-2xl"
					/>
					<IonLabel class="text-xs!">{{ tab.label }}</IonLabel>
					<IonBadge
						v-if="tab.tab === 'today' && remainingCount > 0"
						color="primary"
						aria-hidden="true"
						class="min-w-4! px-1! text-[0.625rem]! leading-none! font-semibold!"
					>
						{{ remainingCount }}
					</IonBadge>
				</IonTabButton>
			</IonTabBar>
		</IonTabs>
	</IonPage>
</template>

<script setup lang="ts">
import slide from '~/animations/slide';

const { t } = useI18n();
const nudges = useNudgesStore();

const tabs = computed(() => [
	{ tab: 'today', href: '/tabs/today', icon: 'mdi:weather-sunny', label: t('nav.today') },
	{ tab: 'playground', href: '/tabs/playground', icon: 'mdi:slide', label: t('nav.playground') },
	{
		tab: 'out-there',
		href: '/tabs/out-there',
		icon: 'mdi:compass-outline',
		label: t('nav.outThere')
	},
	{ tab: 'week', href: '/tabs/week', icon: 'mdi:calendar-week', label: t('nav.week') },
	{ tab: 'settings', href: '/tabs/settings', icon: 'mdi:cog', label: t('nav.settings') }
]);

// ionic's own default resolves to text-step-350, which sits *above* the selected
// primary in contrast and inverts the hierarchy
const barStyle = {
	'--color': 'var(--ion-text-color-step-400)',
	'--color-selected': 'var(--ion-color-primary)'
};

const remainingCount = computed(() => nudges.remaining.length);

/**
 * The badge is hidden from the accessibility tree, and the tab carries no `aria-label`.
 *
 * Hiding the badge is what makes the name stable: composed from its children the Today tab
 * read as "Today 4" and changed on every resolution - a bare number with no unit for a screen
 * reader, and a moving target for the Maestro flows, which can only select by accessible name.
 * With the badge hidden the composed name is just "Today", so no `aria-label` is needed.
 *
 * And an `aria-label` here actively breaks things: Ionic relocates a host `aria-label` onto
 * its shadow native element, so Maestro matched that inner node instead of the tab button and
 * a tap on it navigated nowhere. Three flows failed on the assertion after a tab tap.
 *
 * The count is not lost either way - the Today page states it in words as "{count} Left Today".
 */
</script>

<style scoped>
/* the selected tab is a hue change only; ionic never re-weights it, and blue-on-white
   sits lower than the grey it replaces */
ion-tab-button.tab-selected ion-label {
	font-weight: 600;
}
</style>
