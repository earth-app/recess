import type { LedgerEntry } from '~/types/context';
import type { Nudge } from '~/types/nudge';
import { nudgeTitle } from '~/types/nudge';
import { generate } from '~/utils/ml';

// Verbal, specific feedback ENHANCES intrinsic motivation (+0.33, Deci 1999)
// where generic praise does nothing. So this reacts to what the user actually
// submitted, and falls back to a deterministic line rather than a canned "Nice
// work!" when the model is absent.

const MAX_FEEDBACK_CHARS = 160;
const MAX_REFLECTION_CHARS = 420;

/** deterministic fallbacks; specific to the category, never generic praise */
const FALLBACK_FEEDBACK: Record<string, string> = {
	people: "That's one more person who had a slightly better day.",
	adventure: "Somewhere you'd never been until today.",
	home: 'Small thing, done. The room knows.',
	learn: "You can't un-know that now.",
	cooking: 'Something exists that did not exist an hour ago.',
	nature: 'It was doing that whether or not anyone looked. You looked.',
	errands: 'Off the list. It stops taking up room now.',
	exercise: 'Your body did a thing it was built for.',
	art: 'It exists. That was the hard part.'
};

export function fallbackFeedback(nudge: Nudge): string {
	return FALLBACK_FEEDBACK[nudge.category] ?? 'Done, and it counted.';
}

/** trim a model's output to one clean sentence-ish fragment */
export function tidyGenerated(raw: string | null, limit: number): string | null {
	if (!raw) return null;

	const cleaned = raw
		.replace(/^["'\s]+|["'\s]+$/g, '')
		// models like to restate the instruction back at you, often as an
		// interjection AND a lead-in, so both parts strip in one pass
		.replace(
			/^(?:(?:sure|certainly|of course|okay|ok|got it)\b[\s!,.:;-]*)?(?:here(?:'s| is)[^:]{0,40}:\s*)?/i,
			''
		)
		.replace(/\s+/g, ' ')
		.trim();

	if (cleaned.length === 0) return null;
	if (cleaned.length <= limit) return cleaned;

	// cut at the last sentence end that fits rather than mid-word
	const clipped = cleaned.slice(0, limit);
	const lastStop = Math.max(
		clipped.lastIndexOf('. '),
		clipped.lastIndexOf('! '),
		clipped.lastIndexOf('? ')
	);
	return lastStop > limit * 0.4 ? clipped.slice(0, lastStop + 1) : `${clipped.trimEnd()}...`;
}

export function feedbackPrompt(nudge: Nudge, submitted: string | null): string {
	const what = submitted
		? `They wrote: "${submitted.slice(0, 300)}"`
		: 'They did not write anything.';

	return [
		'You are writing one short line of warm, specific feedback to someone who just finished a small everyday nudge.',
		`The nudge was: "${nudgeTitle(nudge)}"`,
		what,
		'',
		'Rules: exactly one sentence, under 20 words. React to what they actually did.',
		'No exclamation marks. No "great job", "amazing", "well done" or any generic praise.',
		'Do not mention points, streaks or the app. Plain ASCII only.'
	].join('\n');
}

export function reflectionPrompt(entries: readonly LedgerEntry[]): string {
	const categories = [...new Set(entries.map((entry) => entry.category))];
	const days = new Set(entries.map((entry) => entry.day)).size;
	const written = entries
		.map((entry) => entry.text)
		.filter((text): text is string => typeof text === 'string' && text.length > 0)
		.slice(0, 3);

	return [
		'You are writing a short reflection for someone looking back at their week in a small everyday-nudges app.',
		`They finished ${entries.length} nudges across ${days} days.`,
		`Areas touched: ${categories.join(', ') || 'none'}.`,
		written.length > 0
			? `Some of what they wrote: ${written.map((t) => `"${t.slice(0, 120)}"`).join('; ')}`
			: '',
		'',
		'Rules: two or three sentences, under 60 words total. Observational, not congratulatory.',
		'Notice a pattern if there is one. No exclamation marks, no generic praise, no advice.',
		'Do not mention points or streaks. Plain ASCII only.'
	]
		.filter(Boolean)
		.join('\n');
}

/** deterministic weekly line so the surface never looks broken without the pack */
export function fallbackReflection(entries: readonly LedgerEntry[]): string {
	if (entries.length === 0) return 'Nothing yet this week. That is also a kind of week.';

	const days = new Set(entries.map((entry) => entry.day)).size;
	const categories = new Set(entries.map((entry) => entry.category)).size;

	if (days === 1) return `Everything happened on one day this week. ${entries.length} of them.`;
	if (categories === 1)
		return `A single-minded week - ${entries.length} nudges, all in one direction.`;
	return `${entries.length} nudges across ${days} days, spread over ${categories} different areas.`;
}

export function useWriting() {
	const models = useModelsStore();
	const settings = useAppSettingsState();
	const { warm } = useModels();
	const { benchmark } = useCapability();

	const generating = ref(false);

	function options() {
		return {
			tier: models.tier,
			locale: settings.value.locale,
			webgpu: benchmark.value?.webgpu ?? false,
			allowRemote: false
		};
	}

	async function run(prompt: string, limit: number, maxTokens: number): Promise<string | null> {
		if (!models.has('writing')) return null;

		generating.value = true;
		try {
			await warm('writing');
			return tidyGenerated(await generate(prompt, { ...options(), maxTokens }), limit);
		} catch {
			return null;
		} finally {
			generating.value = false;
		}
	}

	/**
	 * never on the critical path: points are awarded before this is called, so a
	 * slow or missing model cannot hold up the reward.
	 */
	async function feedbackFor(nudge: Nudge, submitted: string | null = null): Promise<string> {
		return (
			(await run(feedbackPrompt(nudge, submitted), MAX_FEEDBACK_CHARS, 48)) ??
			fallbackFeedback(nudge)
		);
	}

	async function reflectionFor(entries: readonly LedgerEntry[]): Promise<string> {
		return (
			(await run(reflectionPrompt(entries), MAX_REFLECTION_CHARS, 120)) ??
			fallbackReflection(entries)
		);
	}

	return {
		generating: readonly(generating),
		available: computed(() => models.has('writing')),
		feedbackFor,
		reflectionFor
	};
}
