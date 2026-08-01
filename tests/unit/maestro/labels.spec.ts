// @vitest-environment node
import { readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, eachCommand, loadFlows, selectorsForCommand, walk } from './harness';

/**
 * Every selector a flow taps, checked against the copy the app actually renders.
 *
 * The point is speed of feedback: a renamed label should fail here in the sub-2s unit lane,
 * not 12 minutes into a device run as a mystery tap timeout.
 *
 * Adapted from sky, which greps `src/` for the literal - recess keeps all of its copy in
 * `i18n/locales/*.json`, so this compares against message *values* instead. That is a
 * stronger check than a substring search: it is an exact match on the whole rendered string,
 * so a label that merely contains the selector no longer counts.
 */

const MESSAGES_PATH = join(REPO_ROOT, 'i18n/locales/en.json');
const SRC_DIR = join(REPO_ROOT, 'src');

type Messages = Record<string, unknown>;

/** every leaf string in the locale file, as `dotted.path` -> value */
function flatten(node: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
	if (typeof node === 'string') {
		out.set(path, node);
		return out;
	}
	if (node && typeof node === 'object' && !Array.isArray(node)) {
		for (const [key, child] of Object.entries(node as Messages)) {
			flatten(child, path ? `${path}.${key}` : key, out);
		}
	}
	return out;
}

const messages = flatten(JSON.parse(readFileSync(MESSAGES_PATH, 'utf8')) as Messages);
const messageValues = new Set(messages.values());

/**
 * Strings owned by the OS, not by recess. They can never appear in a locale file, so each is
 * listed with the system surface it belongs to and nothing else is exempt.
 */
const OS_OWNED = new Map<string, string>([
	['Cancel', 'dismiss button on a leftover iOS system alert'],
	[
		'Allow|OK|Continue',
		'affirmative buttons across the iOS permission sheets, matched as one alternation because settle.yml cannot know which overlay it got'
	],
	[
		'Allow|OK|Continue|Cancel',
		'the same set plus Cancel, for settle.yml second dismissal pass where a stacked overlay may only offer a decline'
	]
]);

/**
 * Selectors no single message value can back, because the app interpolates or pluralises
 * them. Each names the message it comes from and a string that message can really render,
 * and the test below proves the three agree - so renaming the message still fails here.
 */
const DERIVED = new Map<string, { key: string; sample: string; composed?: true }>([
	['4 Left Today', { key: 'today.headlineLeft', sample: '4 Left Today' }],
	['3 Left Today', { key: 'today.headlineLeft', sample: '3 Left Today' }],
	['Grown from 0 Nudges', { key: 'playground.grownFrom', sample: 'Grown from 0 Nudges' }],
	['Grown from 1 Nudge', { key: 'playground.grownFrom', sample: 'Grown from 1 Nudge' }],
	// the deck's front card names itself "<action>: <nudge title>", so the message is a prefix
	// of the accessible name rather than the whole of it
	[
		'Open this Nudge: .*',
		{
			key: 'today.openNudge',
			sample: 'Open this Nudge: Notice the first bird you hear',
			composed: true
		}
	]
]);

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A message with every interpolation hole widened, so it matches anything it could render.
 * A `|`-pluralised message contributes one pattern per branch.
 */
export function messagePatterns(message: string): RegExp[] {
	return message.split('|').map((branch) => {
		const literals = branch
			.trim()
			.split(/\{[^}]*\}/g)
			.map(escapeRegex);
		return new RegExp(`^${literals.join('.*')}$`);
	});
}

/** maestro matches a selector against the whole accessible name, so anchor it the same way */
export function selectorPattern(selector: string): RegExp {
	return new RegExp(`^(?:${selector})$`);
}

type Selector = { flow: string; key: string; value: string };

const selectors: Selector[] = loadFlows().flatMap((flow) =>
	eachCommand(flow.commands).flatMap(({ name, payload }) =>
		selectorsForCommand(name, payload).map(({ key, value }) => ({ flow: flow.rel, key, value }))
	)
);

const textSelectors = selectors.filter((selector) => selector.key === 'text');
const uniqueText = [...new Set(textSelectors.map((selector) => selector.value))].sort();

const sourceFiles = walk(SRC_DIR)
	.filter((path) => ['.vue', '.ts'].includes(extname(path)))
	.map((path) => ({ rel: relative(REPO_ROOT, path), body: readFileSync(path, 'utf8') }));

function filesContaining(needle: string): string[] {
	return sourceFiles.filter((file) => file.body.includes(needle)).map((file) => file.rel);
}

describe('maestro selector contract', () => {
	it('collects a real selector inventory', () => {
		expect(uniqueText.length).toBeGreaterThan(25);
	});

	it('reads a real locale file, so a wrong path cannot pass vacuously', () => {
		expect(messages.size).toBeGreaterThan(300);
		expect(messages.get('nav.today')).toBe('Today');
	});

	it('backs every text selector with a string the app renders', () => {
		const missing: string[] = [];
		for (const value of uniqueText) {
			if (OS_OWNED.has(value) || DERIVED.has(value)) continue;
			if (!messageValues.has(value)) {
				const flows = textSelectors
					.filter((selector) => selector.value === value)
					.map((selector) => selector.flow);
				missing.push(`"${value}" (used by ${[...new Set(flows)].join(', ')})`);
			}
		}
		expect(missing, 'selectors with no matching message in i18n/locales/en.json').toEqual([]);
	});

	it('keeps the OS-owned exemption list minimal and honest', () => {
		for (const [value, surface] of OS_OWNED) {
			expect(surface.length, `${value} needs a reason`).toBeGreaterThan(10);
			expect(uniqueText, `${value} is exempt but no flow uses it`).toContain(value);
		}
	});

	it('backs every derived selector with the message that renders it', () => {
		for (const [selector, { key, sample, composed }] of DERIVED) {
			const message = messages.get(key);
			expect(message, `${selector}: ${key} no longer exists`).toBeTypeOf('string');
			// a composed name embeds the message in something larger, so the message has to be a
			// real prefix of the sample rather than match it whole
			expect(
				composed
					? sample.startsWith(message!)
					: messagePatterns(message!).some((pattern) => pattern.test(sample)),
				`${selector}: ${key} cannot render "${sample}"`
			).toBe(true);
			expect(selectorPattern(selector).test(sample), `${selector} never matches "${sample}"`).toBe(
				true
			);
		}
	});

	it('keeps the derived list minimal and honest', () => {
		for (const selector of DERIVED.keys()) {
			expect(uniqueText, `${selector} is declared derived but no flow uses it`).toContain(selector);
		}
	});

	it('would notice a renamed message', () => {
		// positive control: proves the match discriminates rather than passing everything
		expect(messageValues.has('Start Something Today')).toBe(true);
		expect(messageValues.has('Start Something Today Renamed')).toBe(false);
	});

	it('would notice a renamed template, and never matches a wider name', () => {
		expect(messagePatterns('{count} Left Today')[0]!.test('4 Left Today')).toBe(true);
		expect(messagePatterns('{count} Remaining Today')[0]!.test('4 Left Today')).toBe(false);
		// a pluralised message contributes one pattern per branch, and the singular branch
		// must not match a plural rendering
		const grown = messagePatterns('Grown from {count} Nudge | Grown from {count} Nudges');
		expect(grown).toHaveLength(2);
		expect(grown[0]!.test('Grown from 1 Nudge')).toBe(true);
		expect(grown[0]!.test('Grown from 2 Nudges')).toBe(false);
		expect(grown[1]!.test('Grown from 2 Nudges')).toBe(true);
	});

	/**
	 * The tab bar is load-bearing for every native flow, and it has exactly one requirement:
	 * the badge must stay out of the accessible name. Composed from its children the Today tab
	 * read as "Today 4" and changed on every resolution; with the badge hidden it is just
	 * "Today".
	 *
	 * An `aria-label` on the host is the wrong fix and is asserted against here. Ionic
	 * relocates a host `aria-label` onto its shadow native element, so Maestro matched that
	 * inner node rather than the tab button and a tap on it navigated nowhere - three flows
	 * failed on the assertion right after a tab tap, and only a device run showed it.
	 */
	it('pins the tab bar contract the whole suite is built on', () => {
		const tabs = sourceFiles.find((file) => file.rel === 'src/pages/tabs.vue');
		expect(tabs, 'src/pages/tabs.vue exists').toBeDefined();
		expect(tabs!.body, 'the badge must stay out of the accessible name').toContain(
			'aria-hidden="true"'
		);
		expect(
			tabs!.body,
			'an aria-label on ion-tab-button moves to its shadow node and breaks the tap target'
		).not.toContain(':aria-label="tab.label"');
		for (const tab of ['today', 'playground', 'week', 'settings']) {
			expect(messages.get(`nav.${tab}`), `nav.${tab} is missing`).toBeTypeOf('string');
		}
	});

	// the two playground toolbar buttons are icon-only, so an aria-label is the only handle
	it('pins the icon-only controls a flow could not otherwise reach', () => {
		expect(filesContaining(':aria-label="t(\'playground.shareTitle\')"')).toContain(
			'src/pages/tabs/playground.vue'
		);
		expect(filesContaining(':aria-label="t(\'playground.export.open\')"')).toContain(
			'src/pages/tabs/playground.vue'
		);
		expect(filesContaining(':aria-label="t(\'common.close\')"')).toContain(
			'src/components/nudge/Sheet.vue'
		);
	});

	/**
	 * The fail-closed contract, pinned from the flow side. `resolve-a-nudge.yml` asserts that a
	 * nudge needing an absent model offers self-attestation, and that assertion is worthless if
	 * the message it looks for stops being the one the UI shows.
	 */
	it('pins the self-attestation copy the fail-closed flow depends on', () => {
		expect(messages.get('validation.selfAttest')).toBe('Mark it Done Myself');
		expect(messages.get('validation.unavailableTitle')).toBe("We couldn't Check this One");
		expect(filesContaining('validation.selfAttest')).not.toEqual([]);
	});

	// the splash only clears once the boot chain calls hide(), which is what makes "content
	// rendered" a real assertion rather than a screenshot of a splash screen
	it('keeps launchAutoHide false, so a painted screen proves the boot chain ran', () => {
		const config = readFileSync(join(REPO_ROOT, 'capacitor.config.ts'), 'utf8');
		expect(config).toContain('launchAutoHide: false');
		expect(config).toContain("appId: 'com.earthapp.recess'");
	});
});
