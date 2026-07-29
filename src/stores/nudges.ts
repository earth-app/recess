import { defineStore } from 'pinia';
import { lockedTypesAt } from '~/composables/useUnlocks';
import type { NudgeContext } from '~/types/context';
import type { Nudge } from '~/types/nudge';
import { loadCatalog, type NormalizeIssue } from '~/utils/data';
import { dayKey } from '~/utils/day';
import { devForceBonus, devPinnedNudgeIds } from '~/utils/dev';
import { installSeedSync } from '~/utils/install';
import { dominantBlocker, recommendDaily, type Recommendation } from '~/utils/recommend';

/** the day's chosen set, so a relaunch does not re-pick against a changed context */
export const PICK_KEY = 'recess.today-pick.v1';

export const useNudgesStore = defineStore('nudges', () => {
	const catalog = ref<Nudge[]>([]);
	const issues = ref<NormalizeIssue[]>([]);
	const loadedLocale = ref<string | null>(null);
	const loading = ref(false);

	const recommendation = ref<Recommendation | null>(null);
	const recommendedFor = ref<string | null>(null);

	const byId = computed(() => {
		const map = new Map<string, Nudge>();
		for (const nudge of catalog.value) map.set(nudge.id, nudge);
		return map;
	});

	function find(id: string): Nudge | undefined {
		return byId.value.get(id);
	}

	async function load(locale: string) {
		if (loadedLocale.value === locale) return;
		loading.value = true;
		try {
			const result = await loadCatalog(locale);
			catalog.value = result.nudges;
			issues.value = result.issues;
			loadedLocale.value = locale;
			// the pool changed, so any existing pick is stale
			recommendation.value = null;
			recommendedFor.value = null;
		} finally {
			loading.value = false;
		}
	}

	/**
	 * Re-pick the day's set.
	 *
	 * Deterministic given its inputs, but the inputs are not all stable through a day:
	 * the weather snapshot arrives asynchronously and is then cached, so the same day
	 * legitimately produced a different set before and after it landed. `ensure` is what
	 * keeps the day stable; this is the only thing that chooses.
	 */
	function refresh(ctx: NudgeContext) {
		const progress = useProgressStore();
		const settings = useAppSettingsState().value;

		recommendation.value = recommendDaily(catalog.value, ctx, progress.entries, {
			count: settings.dailyCount,
			cooldownDays: settings.cooldownDays,
			enabledCategories: settings.enabledCategories,
			interests: settings.interests,
			// the informational unlocks are only honest if the picker respects them
			lockedTypes: lockedTypesAt(progress.points),
			// keys the day's stream per install, so two people who start the same day do
			// not get the same deck. An empty seed degrades to the day-and-locale stream
			installSeed: installSeedSync()
		});
		recommendedFor.value = ctx.day;
	}

	/**
	 * Bring the day's set up to date, re-picking only on a rollover.
	 *
	 * The picked ids are persisted, because the in-memory guard alone is not enough: a
	 * relaunch reset it, `ensure` re-picked, and by then the weather cache had filled in -
	 * so the four nudges you saw this morning could quietly become four different ones.
	 * "The same day always gives the same set" has to survive a relaunch to mean anything.
	 */
	async function ensure(ctx: NudgeContext) {
		// `ensure` is called from several places, some of which can land before `load`
		// finishes. Picking from an empty catalog produces an empty recommendation that
		// then satisfies the day guard below, so the awaited call short-circuits, the deck
		// stays blank and the day is never persisted. Bailing out is the honest no-op
		if (catalog.value.length === 0) return;

		if (recommendedFor.value === ctx.day && (recommendation.value?.nudges.length ?? 0) > 0) {
			return;
		}

		refresh(ctx);
		// pick first, then pin: the fresh pick still supplies `scored` and the learned
		// model for inspection, and only the visible set is replaced
		await applyStoredPick(ctx.day);
		// written on both branches, so the stored entry always describes the current day.
		// Skipping it on a restore left a stale day key in storage indefinitely
		await persistPick(ctx.day);
	}

	/** the day's chosen ids, so a relaunch shows the same four nudges */
	async function persistPick(day: string) {
		const picked = recommendation.value;
		// an empty set means the catalog was not loaded yet; writing it would clobber a
		// good pick with nothing and the day would silently come back different
		if (!picked || picked.nudges.length === 0) return;

		const { set } = useSettings();
		await set(PICK_KEY, {
			day,
			ids: picked.nudges.map((nudge) => nudge.id),
			bonusId: picked.bonus?.id ?? null
		});
	}

	async function applyStoredPick(day: string): Promise<boolean> {
		const current = recommendation.value;
		if (!current) return false;

		const { get } = useSettings();
		const stored = await get<unknown>(PICK_KEY, null);

		if (!stored || typeof stored !== 'object') return false;
		const record = stored as { day?: unknown; ids?: unknown; bonusId?: unknown };
		if (record.day !== day || !Array.isArray(record.ids) || record.ids.length === 0) return false;

		const nudges = record.ids
			.map((id) => (typeof id === 'string' ? byId.value.get(id) : undefined))
			.filter((nudge): nudge is Nudge => nudge !== undefined);

		// a partial restore would silently shrink the day, so keep the fresh pick instead
		if (nudges.length !== record.ids.length) return false;

		const bonus =
			typeof record.bonusId === 'string' ? (byId.value.get(record.bonusId) ?? null) : null;

		recommendation.value = { ...current, nudges, bonus };
		recommendedFor.value = day;
		return true;
	}

	/**
	 * A pinned nudge is forced to the front, past every filter, so a specific one can
	 * be walked without arranging the weather and the clock to make it eligible.
	 */
	const today = computed<Nudge[]>(() => {
		const picked = recommendation.value?.nudges ?? [];
		const pinned = devPinnedNudgeIds();
		if (pinned.length === 0) return picked;

		const forced = pinned
			.map((id) => byId.value.get(id))
			.filter((nudge): nudge is Nudge => !!nudge);
		const rest = picked.filter((nudge) => !pinned.includes(nudge.id));
		return [...forced, ...rest];
	});
	const bonus = computed<Nudge | null>(() => recommendation.value?.bonus ?? null);

	/** resolved ids for today, so the deck knows what to strike through */
	const resolvedIds = computed(() => {
		const progress = useProgressStore();
		const day = recommendedFor.value ?? dayKey();
		return new Set(progress.entries.filter((entry) => entry.day === day).map((entry) => entry.id));
	});

	const remaining = computed(() => today.value.filter((nudge) => !resolvedIds.value.has(nudge.id)));

	const coreComplete = computed(() => today.value.length > 0 && remaining.value.length === 0);

	/** the bonus stays locked until every core nudge is resolved */
	const bonusAvailable = computed(
		() =>
			(coreComplete.value || devForceBonus()) &&
			bonus.value !== null &&
			!resolvedIds.value.has(bonus.value.id)
	);

	const emptyReason = computed(() => {
		if (today.value.length > 0) return null;
		const blocked = recommendation.value?.blocked ?? [];
		return blocked.length > 0 ? dominantBlocker(blocked) : null;
	});

	return {
		catalog,
		issues,
		loadedLocale,
		loading,
		recommendation,
		recommendedFor,
		today,
		bonus,
		resolvedIds,
		remaining,
		coreComplete,
		bonusAvailable,
		emptyReason,
		find,
		load,
		refresh,
		ensure
	};
});
