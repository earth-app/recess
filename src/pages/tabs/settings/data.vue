<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton default-href="/tabs/settings" />
				</IonButtons>
				<IonTitle>{{ t('settings.data') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<IonList
				:inset="true"
				class="mt-2!"
			>
				<IonItem
					lines="none"
					class="[--min-height:66px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@blue', 0.16) }"
					>
						<UIcon
							name="mdi:database-outline"
							class="text-xl"
							:style="{ color: resolveColor('@blue') }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.entriesStored') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.storedOnDevice') }}
						</p>
					</IonLabel>

					<IonNote
						slot="end"
						class="self-center! pt-0! text-base! font-semibold! tabular-nums! text-(--ion-text-color-step-300)!"
						>{{ progress.entries.length }}</IonNote
					>
				</IonItem>
			</IonList>

			<p class="px-8 pt-1 text-center text-xs text-(--ion-text-color-step-400)">
				{{ t('settings.noBackup') }}
			</p>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					lines="full"
					button
					:detail="false"
					class="[--min-height:70px]"
					@click="onExport"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@green', 0.16) }"
					>
						<UIcon
							name="mdi:tray-arrow-up"
							class="text-xl"
							:style="{ color: resolveColor('@green') }"
						/>
					</span>
					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.exportData') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.exportHint') }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem
					lines="full"
					button
					:detail="false"
					class="[--min-height:70px]"
					@click="onReplayTour"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@teal', 0.16) }"
					>
						<UIcon
							name="mdi:gesture-swipe-horizontal"
							class="text-xl"
							:style="{ color: resolveColor('@teal') }"
						/>
					</span>
					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('tour.replay') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('tour.replayHint') }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem
					lines="full"
					button
					:detail="false"
					class="[--min-height:70px]"
					@click="onReplay"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@indigo', 0.16) }"
					>
						<UIcon
							name="mdi:restart"
							class="text-xl"
							:style="{ color: resolveColor('@indigo') }"
						/>
					</span>
					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.replayOnboarding') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.replayOnboardingHint') }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem
					lines="none"
					button
					:detail="false"
					class="[--min-height:70px]"
					@click="onResetToday"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@gold', 0.16) }"
					>
						<UIcon
							name="mdi:calendar-remove-outline"
							class="text-xl"
							:style="{ color: resolveColor('@gold') }"
						/>
					</span>
					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.resetToday') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.resetTodayHint') }}
						</p>
					</IonLabel>
				</IonItem>
			</IonList>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					lines="none"
					button
					:detail="false"
					class="[--min-height:70px]"
					@click="onWipe"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: 'color-mix(in srgb, var(--ion-color-danger) 16%, transparent)' }"
					>
						<UIcon
							name="mdi:delete-outline"
							class="text-xl text-(--ion-color-danger)"
						/>
					</span>
					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold! text-(--ion-color-danger)!">
							{{ t('settings.wipeData') }}
						</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.wipeConfirm') }}
						</p>
					</IonLabel>
				</IonItem>
			</IonList>

			<div class="h-8" />
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { resolveColor, withAlpha } from '~/utils/color';
import { dayKey } from '~/utils/day';

const { t } = useI18n();
const { replay } = useAppTour();
const progress = useProgressStore();
const { toast, confirm } = useNotify();
const { reset: resetOnboarding } = useOnboarding();

async function onExport() {
	const json = progress.exportJson();
	const name = `recess-export-${dayKey()}.json`;

	if (!Capacitor.isNativePlatform()) {
		downloadInBrowser(json, name);
		return;
	}

	try {
		const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
		const written = await Filesystem.writeFile({
			path: name,
			data: json,
			directory: Directory.Cache,
			encoding: Encoding.UTF8
		});

		const { Share } = await import('@capacitor/share');
		await Share.share({ title: t('settings.exportShareTitle'), url: written.uri });
	} catch {
		await toast(t('settings.exportFailed'));
	}
}

function downloadInBrowser(json: string, name: string) {
	if (typeof document === 'undefined') return;

	const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.style.display = 'none';
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
	void toast(t('settings.exported'));
}

async function onResetToday() {
	const ok = await confirm({
		title: t('settings.resetToday'),
		message: t('settings.resetTodayConfirm'),
		okText: t('settings.resetToday'),
		cancelText: t('common.cancel')
	});
	if (!ok) return;

	await progress.resetToday();
	await toast(t('settings.resetTodayDone'));
}

async function onWipe() {
	const ok = await confirm({
		title: t('settings.wipeData'),
		message: t('settings.wipeConfirm'),
		okText: t('settings.wipeData'),
		cancelText: t('common.cancel')
	});
	if (!ok) return;

	await progress.wipe();
	await toast(t('settings.wipeDone'));
}

async function onReplay() {
	await resetOnboarding();
	await navigateTo('/onboarding');
}

/** the tour points at the deck, so replaying it has to land on Today first */
async function onReplayTour() {
	await replay();
	await navigateTo('/tabs/today');
}
</script>
