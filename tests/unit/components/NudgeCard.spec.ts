import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import NudgeCard from '~/components/nudge/Card.vue';
import type { Nudge } from '~/types/nudge';
import { question, task, think } from '../helpers';

/**
 * The deck card: seven computeds turning any of the seven nudge shapes into one card.
 *
 * The interesting part is that `title` and `body` come from `nudgeTitle` / `nudgeBody`, which know
 * that a task carries `title`/`description` while a think carries `prompt` - so a type whose text
 * lives under a different key must still show something rather than an empty card.
 */

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof NudgeCard>>>;
let mounted: Wrapper | null = null;

async function card(nudge: Nudge) {
	mounted = await mountSuspended(NudgeCard, { props: { nudge } });
	return mounted;
}

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('the copy', () => {
	it('shows a task by its title', async () => {
		const w = await card(task({ title: 'Ask About Nine' }));
		expect(w.text()).toContain('Ask About Nine');
	});

	// a think has no title at all; its prompt is the headline
	it('shows a think by its prompt', async () => {
		const w = await card(think({ prompt: 'Think of a song everyone agrees is bad' }));
		expect(w.text()).toContain('Think of a song everyone agrees is bad');
	});

	it('shows a question by its question text', async () => {
		const w = await card(question({ question: 'Is 100 friends too many?' }));
		expect(w.text()).toContain('Is 100 friends too many?');
	});

	it('never renders an empty headline for any type', async () => {
		for (const nudge of [task(), think(), question()]) {
			const w = await card(nudge);
			expect(
				w.find('h2').text().trim().length,
				`${nudge.type} rendered no headline`
			).toBeGreaterThan(0);
			w.unmount();
		}
	});

	it('names the category in words', async () => {
		const w = await card(task({ category: 'errands' }));
		expect(w.text()).toContain('Errands');
	});

	it('shows the points it is worth', async () => {
		const w = await card(task({ points: 22 }));
		expect(w.text()).toContain('22');
	});
});

describe('the accent', () => {
	/**
	 * Every colour on the card derives from one set of custom properties, so a nudge's authored
	 * colour reaches the tile, the rule and the pill without any of them hardcoding a hue.
	 */
	it('publishes the nudge colour as custom properties', async () => {
		const w = await card(task({ color: '@purple' }));
		const style = w.find('div').attributes('style') ?? '';
		expect(style).toContain('--nudge-accent');
	});

	it('gives two different colours two different accents', async () => {
		const green = await card(task({ color: '@green' }));
		const style = green.find('div').attributes('style') ?? '';
		green.unmount();

		const red = await card(task({ color: '@red' }));
		expect(red.find('div').attributes('style') ?? '').not.toBe(style);
	});
});

describe('the validation hint', () => {
	// the icon tells you what finishing will ask for before you open the sheet
	it('shows a camera for a photo nudge', async () => {
		const w = await card(
			task({
				validation_type: 'photo',
				validation_data: { labels: ['a photo of x'], threshold: 60 }
			} as never)
		);
		expect(w.html()).toContain('camera');
	});

	it('shows a pencil for a written nudge', async () => {
		const w = await card(
			task({
				validation_type: 'text',
				validation_data: { rubric: [{ id: 'r', weight: 1, ideal: 'x' }], threshold: 62 }
			} as never)
		);
		expect(w.html()).toContain('pencil');
	});

	/**
	 * A think has no validator, so there is nothing to promise; the pill is dropped rather than
	 * shown with a neutral icon. `validationIcon`'s fallback is only there to keep `:name` a string
	 * - `validationLabel` gates the pill on the same value, so the fallback never renders.
	 */
	it('shows no pill at all for a type with no validator', async () => {
		// a prompt that avoids the word, so the assertion is about the pill and not the copy
		const w = await card(think({ prompt: 'Consider whichever song is worst' }));
		expect(w.html()).not.toContain('circle-outline');
		expect(w.text(), 'a validation pill with nothing to validate').not.toContain('Think');
	});
});
