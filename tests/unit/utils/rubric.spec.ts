import { describe, expect, it } from 'vitest';
import type { ScoringCriterion } from '~/types/nudge';
import {
	cosineSimilarity,
	normalizeSimilarity,
	normalizeThreshold,
	positiveMass,
	rubricTexts,
	scoreAgainstRubric,
	softmax
} from '~/utils/rubric';

describe('cosineSimilarity', () => {
	it('is 1 for identical vectors', () => {
		expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
	});

	it('is 0 for orthogonal vectors', () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
	});

	it('is -1 for opposed vectors', () => {
		expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
	});

	it('ignores magnitude', () => {
		expect(cosineSimilarity([1, 2], [10, 20])).toBeCloseTo(1, 6);
	});

	it('is 0 rather than NaN for a zero vector', () => {
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
	});

	it('is 0 for empty or mismatched lengths', () => {
		expect(cosineSimilarity([], [])).toBe(0);
		expect(cosineSimilarity([1, 2], [1])).toBe(0);
	});
});

describe('normalizeSimilarity', () => {
	it('maps the cosine range onto 0..1', () => {
		expect(normalizeSimilarity(-1)).toBe(0);
		expect(normalizeSimilarity(0)).toBe(0.5);
		expect(normalizeSimilarity(1)).toBe(1);
	});

	it('means unrelated text floors around 0.5, so a threshold below that is meaningless', () => {
		expect(normalizeSimilarity(0.02)).toBeGreaterThan(0.5);
		expect(normalizeSimilarity(-0.02)).toBeLessThan(0.5);
	});

	it('clamps out-of-range and non-finite input', () => {
		expect(normalizeSimilarity(5)).toBe(1);
		expect(normalizeSimilarity(-5)).toBe(0);
		expect(normalizeSimilarity(Number.NaN)).toBe(0);
	});
});

describe('normalizeThreshold', () => {
	it('accepts a 0-1 fraction unchanged', () => {
		expect(normalizeThreshold(0.62)).toEqual({ ok: true, value: 0.62 });
		expect(normalizeThreshold(0)).toEqual({ ok: true, value: 0 });
	});

	it('reads 1 as a fraction, not one percent', () => {
		expect(normalizeThreshold(1)).toEqual({ ok: true, value: 1 });
	});

	it('divides a percentage', () => {
		expect(normalizeThreshold(62)).toEqual({ ok: true, value: 0.62 });
		expect(normalizeThreshold(100)).toEqual({ ok: true, value: 1 });
	});

	it('rejects negatives, over-100 and non-numbers', () => {
		expect(normalizeThreshold(-0.1).ok).toBe(false);
		expect(normalizeThreshold(101).ok).toBe(false);
		expect(normalizeThreshold(Number.NaN).ok).toBe(false);
		expect(normalizeThreshold(Number.POSITIVE_INFINITY).ok).toBe(false);
		expect(normalizeThreshold('0.5').ok).toBe(false);
		expect(normalizeThreshold(null).ok).toBe(false);
		expect(normalizeThreshold(undefined).ok).toBe(false);
	});

	it('explains itself when it rejects', () => {
		expect(normalizeThreshold(500).message).toBeTruthy();
	});
});

describe('scoreAgainstRubric', () => {
	const rubric: ScoringCriterion[] = [
		{ id: 'relevance', weight: 0.6, ideal: 'about the thing' },
		{ id: 'depth', weight: 0.4, ideal: 'in some detail' }
	];

	it('scores 1 when the subject matches every ideal exactly', () => {
		const result = scoreAgainstRubric(
			[
				[1, 0],
				[1, 0],
				[1, 0]
			],
			rubric
		);
		expect(result.score).toBeCloseTo(1, 6);
	});

	it('scores 0.5 for orthogonal ideals, matching the normalization floor', () => {
		const result = scoreAgainstRubric(
			[
				[1, 0],
				[0, 1],
				[0, 1]
			],
			rubric
		);
		expect(result.score).toBeCloseTo(0.5, 6);
	});

	it('weights each criterion', () => {
		// perfect on relevance (0.6), orthogonal on depth (0.4 * 0.5)
		const result = scoreAgainstRubric(
			[
				[1, 0],
				[1, 0],
				[0, 1]
			],
			rubric
		);
		expect(result.score).toBeCloseTo(0.6 + 0.2, 6);
	});

	it('reports a per-criterion breakdown', () => {
		const result = scoreAgainstRubric(
			[
				[1, 0],
				[1, 0],
				[0, 1]
			],
			rubric
		);
		expect(result.breakdown.map((b) => b.id)).toEqual(['relevance', 'depth']);
		expect(result.breakdown[0]?.weighted).toBeCloseTo(0.6, 6);
	});

	it('throws on an empty rubric', () => {
		expect(() => scoreAgainstRubric([[1]], [])).toThrow(/must not be empty/);
	});

	it('throws when weights do not sum to 1', () => {
		const bad: ScoringCriterion[] = [{ id: 'a', weight: 0.5, ideal: 'x' }];
		expect(() => scoreAgainstRubric([[1], [1]], bad)).toThrow(/sum to 1/);
	});

	it('tolerates floating-point weight drift', () => {
		const drifting: ScoringCriterion[] = [
			{ id: 'a', weight: 0.3333, ideal: 'x' },
			{ id: 'b', weight: 0.3333, ideal: 'y' },
			{ id: 'c', weight: 0.3334, ideal: 'z' }
		];
		expect(() => scoreAgainstRubric([[1], [1], [1], [1]], drifting)).not.toThrow();
	});

	it('throws when the embedding count does not match the rubric', () => {
		expect(() =>
			scoreAgainstRubric(
				[
					[1, 0],
					[1, 0]
				],
				rubric
			)
		).toThrow(/expected 3 embeddings/);
	});
});

describe('rubricTexts', () => {
	it('puts the subject first, then every ideal in order', () => {
		const rubric: ScoringCriterion[] = [
			{ id: 'a', weight: 0.5, ideal: 'first ideal' },
			{ id: 'b', weight: 0.5, ideal: 'second ideal' }
		];
		expect(rubricTexts('what they wrote', rubric)).toEqual([
			'what they wrote',
			'first ideal',
			'second ideal'
		]);
	});
});

describe('softmax', () => {
	it('sums to 1', () => {
		const probabilities = softmax([2, 1, 0.5]);
		expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
	});

	it('is uniform for equal logits', () => {
		expect(softmax([1, 1, 1, 1])).toEqual([0.25, 0.25, 0.25, 0.25]);
	});

	it('preserves ordering', () => {
		const [a, b, c] = softmax([3, 2, 1]);
		expect(a).toBeGreaterThan(b as number);
		expect(b).toBeGreaterThan(c as number);
	});

	it('does not overflow on large logits', () => {
		const probabilities = softmax([1000, 999]);
		expect(probabilities.every((p) => Number.isFinite(p))).toBe(true);
		expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
	});

	it('sharpens with a lower temperature', () => {
		const soft = softmax([2, 1], 1);
		const sharp = softmax([2, 1], 0.2);
		expect(sharp[0]).toBeGreaterThan(soft[0] as number);
	});

	it('returns an empty array for no logits', () => {
		expect(softmax([])).toEqual([]);
	});
});

describe('positiveMass', () => {
	it('sums the leading entries', () => {
		expect(positiveMass([0.5, 0.2, 0.3], 2)).toBeCloseTo(0.7, 6);
	});

	it('is 0 when nothing is positive', () => {
		expect(positiveMass([0.5, 0.5], 0)).toBe(0);
		expect(positiveMass([0.5, 0.5], -1)).toBe(0);
	});

	it('is 1 when every entry counts', () => {
		expect(positiveMass([0.4, 0.6], 2)).toBeCloseTo(1, 6);
	});
});
