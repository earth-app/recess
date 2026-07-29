import type { ScoringCriterion } from '~/types/nudge';

export interface ScoreBreakdown {
	id: string;
	similarity: number;
	normalized: number;
	weighted: number;
}

export interface ScoreResult {
	score: number;
	breakdown: ScoreBreakdown[];
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	if (a.length === 0 || a.length !== b.length) return 0;

	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] as number;
		const y = b[i] as number;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
	return magnitude === 0 ? 0 : dot / magnitude;
}

/** smooth map to 0..1; avoids the clipping skew of max(0, sim) */
export function normalizeSimilarity(similarity: number): number {
	if (!Number.isFinite(similarity)) return 0;
	return Math.min(1, Math.max(0, (similarity + 1) / 2));
}

export interface ThresholdResult {
	ok: boolean;
	value: number;
	message?: string;
}

/**
 * accepts either a 0-1 fraction or a 0-100 percentage. 1 is ambiguous and is
 * read as a fraction, matching cloud.
 */
export function normalizeThreshold(raw: unknown): ThresholdResult {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return { ok: false, value: 0, message: 'threshold must be a finite number' };
	}
	if (raw < 0) return { ok: false, value: 0, message: 'threshold must not be negative' };
	if (raw <= 1) return { ok: true, value: raw };
	if (raw <= 100) return { ok: true, value: raw / 100 };
	return {
		ok: false,
		value: 0,
		message: 'threshold must be in the 0-1 range or 0-100 percentage range'
	};
}

/**
 * weighted cosine score of one text against a rubric. `embeddings[0]` is the
 * subject, the rest align to `rubric` in order.
 */
export function scoreAgainstRubric(
	embeddings: readonly number[][],
	rubric: readonly ScoringCriterion[]
): ScoreResult {
	if (rubric.length === 0) throw new Error('rubric must not be empty');
	if (embeddings.length !== rubric.length + 1) {
		throw new Error(`expected ${rubric.length + 1} embeddings, received ${embeddings.length}`);
	}

	const total = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
	if (Math.abs(total - 1) > 0.001) throw new Error('rubric weights must sum to 1.0');

	const subject = embeddings[0] as number[];
	const breakdown: ScoreBreakdown[] = [];
	let score = 0;

	for (let i = 0; i < rubric.length; i++) {
		const criterion = rubric[i] as ScoringCriterion;
		const similarity = cosineSimilarity(subject, embeddings[i + 1] as number[]);
		const normalized = normalizeSimilarity(similarity);
		const weighted = normalized * criterion.weight;
		score += weighted;
		breakdown.push({ id: criterion.id, similarity, normalized, weighted });
	}

	return { score, breakdown };
}

/** the texts to embed for a rubric scoring pass, subject first */
export function rubricTexts(subject: string, rubric: readonly ScoringCriterion[]): string[] {
	return [subject, ...rubric.map((criterion) => criterion.ideal)];
}

export function softmax(logits: readonly number[], temperature = 1): number[] {
	if (logits.length === 0) return [];
	const scaled = logits.map((logit) => logit / (temperature || 1));
	const max = Math.max(...scaled);
	const exps = scaled.map((value) => Math.exp(value - max));
	const sum = exps.reduce((a, b) => a + b, 0);
	return sum === 0 ? exps.map(() => 0) : exps.map((value) => value / sum);
}

/** total probability mass landing on the first `positiveCount` entries */
export function positiveMass(probabilities: readonly number[], positiveCount: number): number {
	if (positiveCount <= 0) return 0;
	return probabilities.slice(0, positiveCount).reduce((sum, p) => sum + p, 0);
}
