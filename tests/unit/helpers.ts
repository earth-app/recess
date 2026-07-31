import { vi, type Mock } from 'vitest';
import type { LedgerEntry, NudgeContext, WeatherSnapshot } from '~/types/context';
import type { Nudge, NudgeCategory, QuestionNudge, TaskNudge, ThinkNudge } from '~/types/nudge';
import { dayKey } from '~/utils/day';
import type { Submission, Verdict } from '~/utils/validate';

// Local factories with Partial overrides rather than shared fixtures, so each
// spec states exactly the part of the world it cares about.

export const FIXED_NOW = new Date('2026-07-27T14:30:00Z');

export function ctx(overrides: Partial<NudgeContext> = {}): NudgeContext {
	const now = overrides.now ?? FIXED_NOW;
	return {
		now,
		day: dayKey(now),
		hour: 14,
		weekday: now.getDay(),
		time_of_day: 'day',
		season: 'summer',
		moon_phase: 'full',
		moon_illumination: 1,
		locale: 'en',
		points: 0,
		streak_days: 0,
		completed_today: 0,
		completions: {},
		granted_permissions: [],
		installed_packs: [],
		...overrides
	};
}

export function weather(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
	return {
		code: 0,
		condition: 'clear',
		temperature_c: 18,
		wind_speed_kmh: 5,
		humidity: 50,
		uv_index: 3,
		is_day: true,
		fetched_at: FIXED_NOW.getTime(),
		latitude: 41.88,
		longitude: -87.63,
		...overrides
	};
}

export function think(overrides: Partial<ThinkNudge> = {}): ThinkNudge {
	return {
		id: 'nature.think.example',
		slug: 'example',
		category: 'nature',
		type: 'think',
		locale: 'en',
		icon: 'mdi:leaf',
		color: '@green',
		points: 5,
		filters: [],
		tags: [],
		prompt: 'Think about something.',
		...overrides
	};
}

/** a real question nudge, for tests that need a type other than think/task */
export function question(overrides: Partial<QuestionNudge> = {}): QuestionNudge {
	return {
		id: 'people.question.example',
		slug: 'example',
		category: 'people',
		type: 'question',
		locale: 'en',
		icon: 'mdi:comment-question-outline',
		color: '@yellow',
		points: 5,
		filters: [],
		tags: [],
		question: 'Is 100 friends too many or not enough?',
		actions: [
			{ label: 'Too many', color: '@red' },
			{ label: 'Not enough', color: '@green' }
		],
		...overrides
	};
}

export function task(overrides: Partial<TaskNudge> = {}): TaskNudge {
	return {
		id: 'people.task.example',
		slug: 'example',
		category: 'people',
		type: 'task',
		locale: 'en',
		icon: 'mdi:hand-wave',
		color: '@yellow',
		points: 10,
		filters: [],
		tags: [],
		title: 'Do a Thing',
		description: 'A thing worth doing.',
		validation_type: 'confirm',
		...overrides
	} as TaskNudge;
}

/** a small catalog spread across categories, types and points bands */
export function catalog(): Nudge[] {
	const categories: NudgeCategory[] = [
		'people',
		'nature',
		'art',
		'learn',
		'cooking',
		'home',
		'errands',
		'exercise',
		'adventure'
	];

	return categories.flatMap((category, index) =>
		[5, 15, 25].map((points, band) =>
			think({
				id: `${category}.think.n${band}`,
				slug: `n${band}`,
				category,
				points,
				tags: [`tag-${index}`]
			})
		)
	);
}

export function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
	const at = overrides.at ?? FIXED_NOW.getTime();
	return {
		id: 'nature.think.example',
		category: 'nature',
		type: 'think',
		outcome: 'passed',
		points: 5,
		at,
		day: dayKey(new Date(at)),
		...overrides
	};
}

/** ledger entries on the given day offsets, most recent = offset 0 */
export function entriesOnDays(offsets: number[], now = FIXED_NOW): LedgerEntry[] {
	return offsets.map((offset, index) => {
		const at = now.getTime() - offset * 86_400_000;
		return entry({ id: `nature.think.d${index}`, at });
	});
}

/**
 * A stand-in for a validation surface's `run` prop, typed rather than cast.
 *
 * `as never` would satisfy the prop but strips `.mock` off the spy, so the assertions that matter -
 * what the surface actually handed the validator - stop typechecking. This keeps both.
 */
export type Runner = (nudge: Nudge, submission: Submission) => Promise<Verdict>;

export function runner(verdict: Verdict = { status: 'passed', score: 0.9 }): Mock<Runner> {
	return vi.fn<Runner>(async () => verdict);
}

/** a runner that stays pending until the returned `release` is called */
export function pendingRunner(verdict: Verdict = { status: 'missed' }): {
	run: Mock<Runner>;
	release: () => void;
} {
	let release = () => {};
	const run = vi.fn<Runner>(
		() =>
			new Promise<Verdict>((resolve) => {
				release = () => resolve(verdict);
			})
	);
	return { run, release: () => release() };
}
