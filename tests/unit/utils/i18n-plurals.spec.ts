// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pluralised copy, checked as text rather than through a mounted component.
 *
 * The bug this exists for: no string in any locale carried a plural form, so a user's very
 * first completion - the highest-visibility moment in the app - rendered "Grown from 1
 * Nudges", and a one-nudge week read "1 nudges" / "1 categories" / "1 days". `{count}`
 * interpolation alone does not pluralise; vue-i18n needs a `|`-separated message AND the
 * count passed as the plural choice, so a half-fix (message only) silently keeps rendering
 * the plural branch.
 */

const LOCALES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../i18n/locales');
const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');

type Messages = Record<string, Record<string, unknown>>;

function load(locale: string): Messages {
	return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')) as Messages;
}

/** the keys that must carry a plural form, with the call site that passes the choice */
const PLURALISED: { key: string; file: string }[] = [
	{ key: 'playground.grownFrom', file: 'pages/tabs/playground.vue' },
	{ key: 'playground.sceneLabel', file: 'components/playground/Canvas.vue' },
	{ key: 'playground.visitorBody', file: 'components/playground/Share.vue' },
	{ key: 'playground.pointsToGo', file: 'pages/tabs/playground.vue' },
	{ key: 'playground.biomeRemaining', file: 'pages/tabs/playground.vue' },
	{ key: 'outThere.placeCount', file: 'components/place/FieldMap.vue' },
	{ key: 'week.nudgesValue', file: 'pages/tabs/week.vue' },
	{ key: 'week.categoriesValue', file: 'pages/tabs/week.vue' },
	{ key: 'week.daysValue', file: 'pages/tabs/week.vue' },
	{ key: 'settings.cooldownValue', file: 'pages/tabs/settings/nudges.vue' },
	{ key: 'today.stripDone', file: 'components/ui/StreakStrip.vue' },
	{ key: 'today.stripRest', file: 'components/ui/StreakStrip.vue' },
	{ key: 'today.stripQuiet', file: 'components/ui/StreakStrip.vue' },
	{ key: 'today.stripAhead', file: 'components/ui/StreakStrip.vue' }
];

/**
 * Keys deliberately left singular-only, each with the reason a count of 1 cannot reach them.
 * Listed so a future `{count}` string cannot quietly join them without a decision.
 */
const SINGLE_FORM_OK = new Map<string, string>([
	['common.points', 'the cheapest nudge is worth 4 points, so no total is ever 1'],
	['common.pointsShort', 'renders as "+N" with no noun to agree with'],
	['today.headlineLeft', '"1 Left Today" already agrees'],
	['today.streakDays', 'a one-day streak takes the separate streakDayOne message'],
	['today.streakLongest', 'only reached above two days'],
	['today.streakResting', 'a paused streak is at least two days old'],
	['nudge.takesMinutes', '"About 1 min" already agrees'],
	['validation.textCounter', '"1 of 80 characters" reads on the total, not the count'],
	['validation.textCounterDone', '"1 characters" is unreachable; the floor is 80'],
	['validation.audioMinSeconds', 'thresholds are 8 seconds and up'],
	['week.minutesValue', '"1 min" already agrees'],
	['week.counted', 'renders as "Counted N" with no noun'],
	['week.personalBest.best', 'renders as "Personal Best: N" with no noun'],
	['week.personalBest.toBeat', '"1 to Beat your Best" already agrees'],
	['onboarding.interestsCount', '"1 picked" already agrees'],
	['notifications.morningBody', '"1 waiting for you today." already agrees'],
	['notifications.middayBody', '"1 left, if you have a minute." already agrees'],
	['notifications.eveningBody', '"1 left. Any one of them counts." already agrees'],
	['settings.dailyCountValue', '"1 a day" already agrees'],
	['today.strip', 'the count is the strip window, 7 or 9 days, never 1'],
	['outThere.walkMinutes', '"1 min" already agrees'],
	['outThere.withinWalk', 'renders as "Within a N Minute Walk"; the floor is 10'],
	['outThere.nothingNearby', 'the radius floor is 10 minutes, so it is never 1']
]);

function read(messages: Messages, key: string): string | undefined {
	const value = key.split('.').reduce<unknown>((node, part) => {
		if (!node || typeof node !== 'object') return undefined;
		return (node as Record<string, unknown>)[part];
	}, messages);
	return typeof value === 'string' ? value : undefined;
}

/** every `{count}`-bearing message in a locale, as dotted paths */
function countKeys(messages: Messages): string[] {
	const out: string[] = [];
	const walk = (node: unknown, path: string) => {
		if (node && typeof node === 'object' && !Array.isArray(node)) {
			for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
				walk(child, path ? `${path}.${key}` : key);
			}
			return;
		}
		if (typeof node === 'string' && node.includes('{count}')) out.push(path);
	};
	walk(messages, '');
	return out.sort();
}

/**
 * vue-i18n's plural selection for a two-form message: choice 1 takes the first branch,
 * everything else the second. Reimplemented rather than mounted so this stays in the
 * sub-2s lane; the shape is what the runtime does for `en` and `es`, which share the rule.
 */
function pick(message: string, choice: number): string {
	const forms = message.split('|').map((form) => form.trim());
	if (forms.length === 1) return forms[0]!;
	return choice === 1 ? forms[0]! : forms[1]!;
}

const LOCALES = ['en', 'es'] as const;

describe('pluralised copy', () => {
	for (const locale of LOCALES) {
		const messages = load(locale);

		describe(locale, () => {
			it('gives every key that needs one exactly two forms', () => {
				for (const { key } of PLURALISED) {
					const message = read(messages, key);
					expect(message, `${key} is missing from ${locale}`).toBeTypeOf('string');
					expect(message!.split('|'), `${key} needs a singular and a plural form`).toHaveLength(2);
				}
			});

			it('keeps {count} in both forms, so neither drops the number', () => {
				for (const { key } of PLURALISED) {
					for (const form of read(messages, key)!.split('|')) {
						expect(form, `${key}: "${form.trim()}" lost its {count}`).toContain('{count}');
					}
				}
			});

			it('carries every other placeholder into both forms', () => {
				for (const { key } of PLURALISED) {
					const forms = read(messages, key)!.split('|');
					const holes = (form: string) => [...form.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
					expect(holes(forms[0]!), `${key}: the two forms interpolate different names`).toEqual(
						holes(forms[1]!)
					);
				}
			});

			// the actual defect: the singular branch must not be the plural one
			it('renders a different string at one than at two', () => {
				for (const { key } of PLURALISED) {
					const message = read(messages, key)!;
					expect(pick(message, 1), `${key} renders the same text at 1 and 2`).not.toBe(
						pick(message, 2)
					);
				}
			});

			it('leaves no {count} message unaccounted for', () => {
				const pluralised = new Set(PLURALISED.map((entry) => entry.key));
				const unexplained = countKeys(messages).filter(
					(key) => !pluralised.has(key) && !SINGLE_FORM_OK.has(key)
				);
				expect(
					unexplained,
					'each {count} message must either carry a plural form or be listed with a reason'
				).toEqual([]);
			});
		});
	}

	it('states a real reason for every single-form exemption', () => {
		for (const [key, reason] of SINGLE_FORM_OK) {
			expect(reason.length, `${key} needs a reason`).toBeGreaterThan(15);
			expect(read(load('en'), key), `${key} is exempt but does not exist`).toBeTypeOf('string');
		}
	});

	/**
	 * The half-fix guard. A `|` in the message does nothing unless the count is also passed
	 * as vue-i18n's plural choice, and that is invisible at the message layer - so assert the
	 * call site really passes a third argument.
	 */
	it('passes the count as the plural choice at every call site', () => {
		for (const { key, file } of PLURALISED) {
			const body = readFileSync(join(SRC_DIR, file), 'utf8');
			const short = key.split('.').slice(1).join('.');

			const at = body.indexOf(`'${key}'`);
			expect(at, `${file} no longer calls t('${key}', ...)`).toBeGreaterThan(-1);

			// walk from the call's own opening paren rather than regexing a window: the
			// biomeRemaining call nests another t() in its named args, and a lazy `.*?\)`
			// stops at that inner paren and reports a truncated argument list
			const open = body.lastIndexOf('(', at);
			expect(open, `${file}: no opening paren before ${key}`).toBeGreaterThan(-1);

			let depth = 0;
			let topLevelCommas = 0;
			for (let index = open; index < body.length; index++) {
				const char = body[index];
				if (char === '(' || char === '{' || char === '[') depth++;
				else if (char === ')' || char === '}' || char === ']') {
					depth--;
					if (depth === 0) break;
				} else if (char === ',' && depth === 1) topLevelCommas++;
			}

			// two arguments is the half-fix: message pluralised, choice never passed
			expect(
				topLevelCommas,
				`${file}: t('${short}') passes no plural choice, so it always renders the plural form`
			).toBeGreaterThanOrEqual(2);
		}
	});
});
