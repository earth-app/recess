import { describe, expect, it, vi } from 'vitest';

/**
 * The EXIF gate, driven through `run()` rather than through `checkFreshCapture` alone.
 *
 * `tests/unit/utils/exif.spec.ts` already covers the forensics in isolation. What was
 * untested is that `run()` ever *reaches* them - and it read `require_fresh_exif` off a
 * hand-written cast (`nudge as { validation_data?: { require_fresh_exif?: boolean } }`)
 * rather than off `photoValidationSchema`, so renaming that field would have made the
 * expression `undefined` forever and silently turned the check off for all 19 nudges that
 * ask for it, with typecheck and the whole suite still green.
 */

const { readExif, checkFreshCapture, warm, has } = vi.hoisted(() => ({
	readExif: vi.fn(async () => ({ dateTimeOriginal: null })),
	checkFreshCapture: vi.fn(() => ({ ok: false, reason: 'That photo was not taken just now.' })),
	warm: vi.fn(async () => {}),
	has: vi.fn(() => false)
}));

vi.mock('~/utils/exif', () => ({ readExif, checkFreshCapture }));

vi.mock('~/utils/ml', () => ({
	clipLogits: vi.fn(async () => null),
	embedTexts: vi.fn(async () => null),
	transcribe: vi.fn(async () => null)
}));

vi.mock('~/composables/useModels', () => ({ useModels: () => ({ warm }) }));
vi.mock('~/composables/useCapability', () => ({
	useCapability: () => ({ benchmark: { value: { webgpu: false } } })
}));
vi.mock('~/stores/models', () => ({
	useModelsStore: () => ({ tier: 1, has })
}));

import { useValidation } from '~/composables/useValidation';
import type { Nudge } from '~/types/nudge';

function photoNudge(requireFresh: boolean): Nudge {
	return {
		id: 'nature.notice.first_bird',
		slug: 'first_bird',
		category: 'nature',
		type: 'notice',
		locale: 'en',
		icon: 'mdi:bird',
		color: '@green',
		points: 8,
		filters: [],
		tags: [],
		prompt: 'Photograph the first bird you see.',
		validation_type: 'photo',
		validation_data: {
			labels: ['a photo of a bird on a branch'],
			threshold: 60,
			...(requireFresh ? { require_fresh_exif: true } : {})
		}
	} as unknown as Nudge;
}

const submission = { kind: 'photo', image: 'data:image/jpeg;base64,AA==' } as never;

describe('useValidation fresh-capture gate', () => {
	it('reaches the EXIF check for a nudge that asks for one', async () => {
		checkFreshCapture.mockReturnValue({ ok: false, reason: 'Not taken just now.' });

		const { run } = useValidation();
		const verdict = await run(photoNudge(true), submission);

		expect(readExif, 'run() never read the EXIF at all').toHaveBeenCalledOnce();
		expect(checkFreshCapture).toHaveBeenCalledOnce();
		expect(verdict.status).toBe('missed');
		expect(verdict).toHaveProperty('detail', 'Not taken just now.');
	});

	it('skips it for a photo nudge that does not ask', async () => {
		readExif.mockClear();
		checkFreshCapture.mockClear();

		const { run } = useValidation();
		await run(photoNudge(false), submission);

		expect(readExif, 'read EXIF for a nudge that never asked for it').not.toHaveBeenCalled();
	});

	// the whole point of the gate: a stale photo must not reach a pass
	it('never returns passed when the capture is stale', async () => {
		readExif.mockClear();
		checkFreshCapture.mockClear();
		checkFreshCapture.mockReturnValue({ ok: false, reason: 'From the camera roll.' });

		const { run } = useValidation();
		const verdict = await run(photoNudge(true), submission);

		expect(verdict.status).not.toBe('passed');
		expect(
			warm,
			'a stale capture should short-circuit before loading a model'
		).not.toHaveBeenCalled();
	});

	it('falls through to the validator when the capture is fresh', async () => {
		readExif.mockClear();
		checkFreshCapture.mockClear();
		checkFreshCapture.mockReturnValue({ ok: true, reason: '' } as never);

		const { run } = useValidation();
		const verdict = await run(photoNudge(true), submission);

		expect(checkFreshCapture).toHaveBeenCalledOnce();
		// no vision pack in this fixture, so the validator has nothing to score with and the
		// fail-closed contract turns that into an explicit self-attest offer
		expect(verdict.status).toBe('unavailable');
	});
});
