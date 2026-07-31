import { describe, expect, it, vi } from 'vitest';
import type { AudioValidationData, PhotoValidationData, TextValidationData } from '~/types/nudge';
import {
	photoLabelSet,
	textLengthWindow,
	validateAudio,
	validateBarcode,
	validateConfirm,
	validateCount,
	validatePhoto,
	validateSubmission,
	validateText
} from '~/utils/validate';
import { task, think } from '../helpers';

const textData: TextValidationData = {
	rubric: [
		{ id: 'relevance', weight: 0.6, ideal: 'about the thing' },
		{ id: 'depth', weight: 0.4, ideal: 'in some detail' }
	],
	threshold: 0.6,
	min_length: 50
};

const photoData: PhotoValidationData = {
	labels: ['a photo of a bird on a branch'],
	negative_labels: ['a photo of an empty sky'],
	threshold: 0.6
};

const audioData: AudioValidationData = {
	rubric: [{ id: 'relevance', weight: 1, ideal: 'about the sound' }],
	threshold: 0.6,
	min_seconds: 5
};

/** every embedding identical, so the rubric scores 1 */
const perfectEmbed = (texts: string[]) => Promise.resolve(texts.map(() => [1, 0, 0]));
/** subject orthogonal to the ideals, so the rubric floors at 0.5 */
const orthogonalEmbed = (texts: string[]) =>
	Promise.resolve(texts.map((_, i) => (i === 0 ? [1, 0, 0] : [0, 1, 0])));

const longEnough = 'x'.repeat(60);

describe('textLengthWindow', () => {
	it('defaults the minimum and clamps to the floor and ceiling', () => {
		expect(textLengthWindow({ ...textData, min_length: undefined })).toEqual({
			min: 120,
			max: 2048
		});
		expect(textLengthWindow({ ...textData, min_length: 50, max_length: 100 })).toEqual({
			min: 50,
			max: 100
		});
	});

	it('never lets max fall below min', () => {
		const window = textLengthWindow({ ...textData, min_length: 500, max_length: 100 });
		expect(window.max).toBeGreaterThanOrEqual(window.min);
	});
});

describe('validateText', () => {
	it('passes a matching response', async () => {
		const verdict = await validateText(textData, longEnough, { scorers: { embed: perfectEmbed } });
		expect(verdict.status).toBe('passed');
	});

	it('misses when the score falls short of the threshold', async () => {
		const verdict = await validateText(textData, longEnough, {
			scorers: { embed: orthogonalEmbed }
		});
		expect(verdict.status).toBe('missed');
		expect(verdict.status === 'missed' && verdict.score).toBeCloseTo(0.5, 3);
	});

	it('misses a response that is too short, before touching the model', async () => {
		const embed = vi.fn(perfectEmbed);
		const verdict = await validateText(textData, 'too short', { scorers: { embed } });
		expect(verdict.status).toBe('missed');
		expect(embed).not.toHaveBeenCalled();
	});

	it('misses a response past the maximum', async () => {
		const verdict = await validateText({ ...textData, max_length: 60 }, 'x'.repeat(200), {
			scorers: { embed: perfectEmbed }
		});
		expect(verdict.status).toBe('missed');
	});

	it('is unavailable, never passed, when no model is installed', async () => {
		const verdict = await validateText(textData, longEnough, {});
		expect(verdict.status).toBe('unavailable');
	});

	it('is unavailable when the model times out', async () => {
		const verdict = await validateText(textData, longEnough, {
			timeoutMs: 5,
			scorers: { embed: () => new Promise((resolve) => setTimeout(() => resolve([[1]]), 200)) }
		});
		expect(verdict.status).toBe('unavailable');
	});

	it('is unavailable when the model rejects', async () => {
		const verdict = await validateText(textData, longEnough, {
			scorers: { embed: () => Promise.reject(new Error('backend gone')) }
		});
		expect(verdict.status).toBe('unavailable');
	});

	it('is unavailable when the embedding count is wrong', async () => {
		const verdict = await validateText(textData, longEnough, {
			scorers: { embed: () => Promise.resolve([[1, 0, 0]]) }
		});
		expect(verdict.status).toBe('unavailable');
	});

	it('is unavailable for an out-of-range threshold', async () => {
		const verdict = await validateText({ ...textData, threshold: 500 }, longEnough, {
			scorers: { embed: perfectEmbed }
		});
		expect(verdict.status).toBe('unavailable');
	});

	it('trims before measuring length', async () => {
		const verdict = await validateText(textData, `   ${'x'.repeat(20)}   `, {
			scorers: { embed: perfectEmbed }
		});
		expect(verdict.status).toBe('missed');
	});
});

describe('photoLabelSet', () => {
	it('puts positives first and appends the authored negatives', () => {
		const { labels, positiveCount } = photoLabelSet(photoData);
		expect(labels[0]).toBe('a photo of a bird on a branch');
		expect(positiveCount).toBe(1);
		expect(labels).toHaveLength(2);
	});

	it('supplies default negatives when none are authored', () => {
		const { labels, positiveCount } = photoLabelSet({ ...photoData, negative_labels: undefined });
		expect(positiveCount).toBe(1);
		expect(labels.length).toBeGreaterThan(1);
	});
});

describe('validatePhoto', () => {
	it('passes when the positive labels take most of the mass', () => {
		return validatePhoto(photoData, new Blob(['x']), {
			scorers: { clipLogits: () => Promise.resolve([10, 0]) }
		}).then((verdict) => expect(verdict.status).toBe('passed'));
	});

	it('misses when the negatives win, and reports what was seen', async () => {
		const verdict = await validatePhoto(photoData, new Blob(['x']), {
			scorers: { clipLogits: () => Promise.resolve([0, 10]) }
		});
		expect(verdict.status).toBe('missed');
		expect(verdict.status === 'missed' && verdict.observed?.length).toBeGreaterThan(0);
	});

	it('is unavailable with no vision model', async () => {
		expect((await validatePhoto(photoData, new Blob(['x']), {})).status).toBe('unavailable');
	});

	it('is unavailable when the logit count does not match the labels', async () => {
		const verdict = await validatePhoto(photoData, new Blob(['x']), {
			scorers: { clipLogits: () => Promise.resolve([1]) }
		});
		expect(verdict.status).toBe('unavailable');
	});

	it('is unavailable on timeout', async () => {
		const verdict = await validatePhoto(photoData, new Blob(['x']), {
			timeoutMs: 5,
			scorers: { clipLogits: () => new Promise((r) => setTimeout(() => r([1, 0]), 200)) }
		});
		expect(verdict.status).toBe('unavailable');
	});
});

describe('validateAudio', () => {
	it('passes a relevant recording', async () => {
		const verdict = await validateAudio(audioData, new Blob(['x']), 10, {
			scorers: { transcribe: () => Promise.resolve('the sound of rain'), embed: perfectEmbed }
		});
		expect(verdict.status).toBe('passed');
	});

	it('misses a recording shorter than the minimum, before transcribing', async () => {
		const transcribe = vi.fn(() => Promise.resolve('hi'));
		const verdict = await validateAudio(audioData, new Blob(['x']), 2, {
			scorers: { transcribe, embed: perfectEmbed }
		});
		expect(verdict.status).toBe('missed');
		expect(transcribe).not.toHaveBeenCalled();
	});

	it('misses an empty transcript', async () => {
		const verdict = await validateAudio(audioData, new Blob(['x']), 10, {
			scorers: { transcribe: () => Promise.resolve('   '), embed: perfectEmbed }
		});
		expect(verdict.status).toBe('missed');
	});

	it('keeps the transcript on the verdict so the user can see it', async () => {
		const verdict = await validateAudio(audioData, new Blob(['x']), 10, {
			scorers: { transcribe: () => Promise.resolve('a blackbird'), embed: perfectEmbed }
		});
		expect(verdict.status === 'passed' && verdict.detail).toBe('a blackbird');
	});

	it('is unavailable when either model is missing', async () => {
		expect(
			(
				await validateAudio(audioData, new Blob(['x']), 10, {
					scorers: { embed: perfectEmbed }
				})
			).status
		).toBe('unavailable');

		expect(
			(
				await validateAudio(audioData, new Blob(['x']), 10, {
					scorers: { transcribe: () => Promise.resolve('words') }
				})
			).status
		).toBe('unavailable');
	});
});

describe('deterministic validators', () => {
	it('confirm always passes', () => {
		expect(validateConfirm().status).toBe('passed');
	});

	it('barcode delegates to the structural check', () => {
		expect(validateBarcode({ kind: 'book' }, { data: '9780262033848', format: 9 }).status).toBe(
			'passed'
		);
		expect(validateBarcode({ kind: 'book' }, { data: '036000291452', format: 14 }).status).toBe(
			'missed'
		);
	});

	it('count accepts a value inside the range', () => {
		expect(validateCount({ min: 1, max: 40 }, 5).status).toBe('passed');
		expect(validateCount({ min: 1, max: 40 }, 1).status).toBe('passed');
		expect(validateCount({ min: 1, max: 40 }, 40).status).toBe('passed');
	});

	it('count rejects out-of-range values with a direction', () => {
		expect(validateCount({ min: 5, max: 40 }, 1).status).toBe('missed');
		expect(validateCount({ min: 1, max: 40 }, 99).status).toBe('missed');
	});

	it('count rejects non-integers and negatives', () => {
		for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(validateCount({ min: 0, max: 40 }, bad).status).toBe('missed');
		}
	});
});

describe('validateSubmission', () => {
	it('passes an unvalidated nudge outright', async () => {
		expect((await validateSubmission(think(), { kind: 'confirm' })).status).toBe('passed');
	});

	it('routes a confirm task', async () => {
		expect((await validateSubmission(task(), { kind: 'confirm' })).status).toBe('passed');
	});

	it('is unavailable when the submission kind does not match the nudge', async () => {
		const verdict = await validateSubmission(task(), { kind: 'text', text: longEnough });
		expect(verdict.status).toBe('unavailable');
	});

	it('routes a text task to the text validator', async () => {
		const textTask = task({
			validation_type: 'text',
			validation_data: textData
		} as never);
		const verdict = await validateSubmission(
			textTask,
			{ kind: 'text', text: longEnough },
			{ scorers: { embed: perfectEmbed } }
		);
		expect(verdict.status).toBe('passed');
	});

	it('routes a count task to the count validator', async () => {
		const countTask = task({
			validation_type: 'count',
			validation_data: { min: 1, max: 10 }
		} as never);
		expect((await validateSubmission(countTask, { kind: 'count', value: 5 })).status).toBe(
			'passed'
		);
		expect((await validateSubmission(countTask, { kind: 'count', value: 50 })).status).toBe(
			'missed'
		);
	});
});
