import type { LedgerEntry } from '~/types/context';
import type { NudgeCategory } from '~/types/nudge';
import { isoWeekKey } from '~/utils/day';

// A deliberately FINITE surface. Self-monitoring reflection is itself therapeutic
// (Hunt 2018), so this is where the app's reflective weight sits - but it ends,
// with nothing to load more of and exactly one way out (back outside).

/** bounded on purpose; an endless archive would undo the point */
export const MAX_PAST_WEEKS = 12;

export interface WeekSummary {
	week: string;
	resolved: number;
	categories: NudgeCategory[];
	minutes: number;
	points: number;
	/** per-category counts, for the stacked bar */
	mix: { category: NudgeCategory; count: number }[];
	/** entries that left something behind: text, a photo, a count */
	highlights: LedgerEntry[];
	isEmpty: boolean;
}

export function summarizeWeek(week: string, entries: readonly LedgerEntry[]): WeekSummary {
	const resolved = entries.filter((entry) => entry.outcome !== 'skipped');

	const counts = new Map<NudgeCategory, number>();
	let minutes = 0;
	let points = 0;

	for (const entry of resolved) {
		counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
		minutes += entry.duration_minutes ?? 0;
		points += entry.points;
	}

	const mix = [...counts.entries()]
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

	const highlights = resolved
		.filter((entry) => entry.text || entry.media || entry.count !== undefined)
		.sort((a, b) => b.at - a.at);

	return {
		week,
		resolved: resolved.length,
		categories: mix.map((item) => item.category),
		minutes,
		points,
		mix,
		highlights,
		isEmpty: resolved.length === 0
	};
}

/** every week with activity, most recent first, capped */
export function weeksWithActivity(
	entries: readonly LedgerEntry[],
	limit = MAX_PAST_WEEKS
): string[] {
	const weeks = new Set<string>();
	for (const entry of entries) {
		if (entry.outcome === 'skipped') continue;
		weeks.add(isoWeekKey(new Date(entry.at)));
	}
	return [...weeks].sort().reverse().slice(0, limit);
}

export function useWeek() {
	const progress = useProgressStore();
	const { reflectionFor } = useWriting();

	const currentWeek = computed(() => isoWeekKey());

	function summaryFor(week: string): WeekSummary {
		return summarizeWeek(week, progress.entriesForWeek(week));
	}

	const thisWeek = computed(() => summaryFor(currentWeek.value));

	const pastWeeks = computed(() =>
		weeksWithActivity(progress.entries).filter((week) => week !== currentWeek.value)
	);

	// generated once per week and cached, so opening the tab twice does not re-run
	// the model
	const reflections = ref<Record<string, string>>({});
	const reflecting = ref(false);

	async function reflection(week: string): Promise<string> {
		const cached = reflections.value[week];
		if (cached) return cached;

		reflecting.value = true;
		try {
			const text = await reflectionFor(progress.entriesForWeek(week));
			reflections.value = { ...reflections.value, [week]: text };
			return text;
		} finally {
			reflecting.value = false;
		}
	}

	return {
		currentWeek,
		thisWeek,
		pastWeeks,
		reflecting: readonly(reflecting),
		summaryFor,
		reflection,
		summarizeWeek,
		weeksWithActivity
	};
}
