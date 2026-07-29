import { defineStore } from 'pinia';
import type { LedgerEntry, NudgeOutcome, ProgressSnapshot } from '~/types/context';
import { NUDGE_CATEGORIES, type Nudge, type ValidationType } from '~/types/nudge';
import { dayKey, isoWeekKey } from '~/utils/day';
import { streakFrom } from '~/utils/streak';

export const PROGRESS_KEY = 'recess.progress.v1';

/** hard cap so Preferences never grows unbounded; oldest entries fall away */
export const MAX_LEDGER_ENTRIES = 4000;

function emptySnapshot(): ProgressSnapshot {
	return { entries: [], points: 0, bests: {} };
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// keyed by the union, so a new outcome fails to compile until it is listed here
const OUTCOMES: Record<NudgeOutcome, true> = {
	passed: true,
	self_attested: true,
	answered: true,
	skipped: true
};

function isLedgerEntry(value: unknown): value is LedgerEntry {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.id === 'string' &&
		(NUDGE_CATEGORIES as readonly string[]).includes(entry.category as string) &&
		OUTCOMES[entry.outcome as NudgeOutcome] === true &&
		Number.isFinite(entry.at) &&
		Number.isFinite(entry.points) &&
		typeof entry.day === 'string' &&
		DAY_KEY_PATTERN.test(entry.day)
	);
}

/** tolerate a partially corrupt blob rather than losing the whole history */
export function parseSnapshot(raw: unknown): ProgressSnapshot {
	if (!raw || typeof raw !== 'object') return emptySnapshot();
	const source = raw as Partial<ProgressSnapshot>;

	const entries = Array.isArray(source.entries) ? source.entries.filter(isLedgerEntry) : [];
	entries.sort((a, b) => a.at - b.at);

	const bests: Record<string, number> = {};
	if (source.bests && typeof source.bests === 'object') {
		for (const [key, value] of Object.entries(source.bests)) {
			if (typeof value === 'number' && Number.isFinite(value)) bests[key] = value;
		}
	}

	// recompute rather than trust a stored total; the ledger is the source of truth
	const points = entries.reduce((sum, entry) => sum + (entry.points || 0), 0);

	return { entries, points, bests };
}

export interface RecordInput {
	nudge: Nudge;
	outcome: NudgeOutcome;
	points: number;
	score?: number;
	choice?: string;
	count?: number;
	text?: string;
	media?: string;
	now?: Date;
}

export const useProgressStore = defineStore('progress', () => {
	const entries = ref<LedgerEntry[]>([]);
	const bests = ref<Record<string, number>>({});
	const ready = ref(false);

	const points = computed(() => entries.value.reduce((sum, entry) => sum + (entry.points || 0), 0));

	const completions = computed(() => {
		const map: Record<string, number> = {};
		for (const entry of entries.value) {
			if (entry.outcome === 'skipped') continue;
			map[entry.id] = Math.max(map[entry.id] ?? 0, entry.at);
		}
		return map;
	});

	const streak = computed(() => streakFrom(entries.value));

	const resolvedToday = computed(() => {
		const today = dayKey();
		return entries.value.filter((entry) => entry.day === today && entry.outcome !== 'skipped');
	});

	const skippedToday = computed(() => {
		const today = dayKey();
		return entries.value.filter((entry) => entry.day === today && entry.outcome === 'skipped');
	});

	function entriesForWeek(week: string) {
		return entries.value.filter((entry) => isoWeekKey(new Date(entry.at)) === week);
	}

	async function load() {
		if (ready.value) return;
		const { get } = useSettings();
		await configurePreferencesGroup();

		const raw = await get<unknown>(PROGRESS_KEY, null);
		const snapshot = parseSnapshot(raw);
		entries.value = snapshot.entries;
		bests.value = snapshot.bests;
		ready.value = true;
	}

	async function persist() {
		const { set } = useSettings();
		await set(PROGRESS_KEY, {
			entries: entries.value,
			points: points.value,
			bests: bests.value
		} satisfies ProgressSnapshot);
	}

	/** high-water marks the ledger cannot derive on its own, e.g. a longest streak */
	function recordBest(key: string, value: number): boolean {
		const previous = bests.value[key] ?? 0;
		if (value <= previous) return false;
		bests.value = { ...bests.value, [key]: value };
		return true;
	}

	async function record(input: RecordInput): Promise<LedgerEntry> {
		await load();

		const now = input.now ?? new Date();
		const validation =
			'validation_type' in input.nudge
				? (input.nudge.validation_type as ValidationType)
				: undefined;

		const entry: LedgerEntry = {
			id: input.nudge.id,
			category: input.nudge.category,
			type: input.nudge.type,
			outcome: input.outcome,
			points: input.outcome === 'skipped' ? 0 : Math.max(0, Math.round(input.points)),
			at: now.getTime(),
			day: dayKey(now),
			validation_type: validation,
			score: input.score,
			choice: input.choice,
			count: input.count,
			text: input.text,
			media: input.media,
			duration_minutes: input.nudge.duration_minutes
		};

		const next = [...entries.value, entry];
		entries.value =
			next.length > MAX_LEDGER_ENTRIES ? next.slice(next.length - MAX_LEDGER_ENTRIES) : next;

		// streak bests are per-category and global; both are self-referential only
		recordBest('streak', streak.value.current);
		recordBest(`category:${entry.category}`, entriesForCategory(entry.category).length);

		await persist();
		return entry;
	}

	function entriesForCategory(category: string) {
		return entries.value.filter(
			(entry) => entry.category === category && entry.outcome !== 'skipped'
		);
	}

	/** undo the most recent entry for a nudge today, for the deck's undo affordance */
	async function undoToday(id: string): Promise<boolean> {
		await load();
		const today = dayKey();
		for (let i = entries.value.length - 1; i >= 0; i--) {
			const entry = entries.value[i] as LedgerEntry;
			if (entry.id === id && entry.day === today) {
				entries.value = [...entries.value.slice(0, i), ...entries.value.slice(i + 1)];
				await persist();
				return true;
			}
		}
		return false;
	}

	async function resetToday() {
		await load();
		const today = dayKey();
		entries.value = entries.value.filter((entry) => entry.day !== today);
		await persist();
	}

	async function wipe() {
		entries.value = [];
		bests.value = {};
		ready.value = true;
		await persist();
	}

	function exportJson(): string {
		return JSON.stringify(
			{
				version: 1,
				exported_at: new Date().toISOString(),
				entries: entries.value,
				bests: bests.value
			},
			null,
			2
		);
	}

	return {
		entries,
		bests,
		ready,
		points,
		completions,
		streak,
		resolvedToday,
		skippedToday,
		entriesForWeek,
		entriesForCategory,
		load,
		record,
		recordBest,
		undoToday,
		resetToday,
		wipe,
		exportJson
	};
});
