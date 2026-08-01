import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EVAL_DIR } from './harness';

export const FIXTURE_DIR = join(EVAL_DIR, 'fixtures');

const caseBase = z.object({
	nudgeId: z.string().min(1),
	shouldPass: z.boolean(),
	note: z.string().min(1)
});

export const textCaseSchema = caseBase.extend({
	text: z.string()
});

export const photoCaseSchema = caseBase.extend({
	/** the caption a correct or incorrect photo would produce; see fixtures/README.md */
	describedAs: z.string().min(1),
	/** optional real image, relative to fixtures/; only the real backend reads it */
	image: z.string().min(1).optional()
});

export const audioCaseSchema = caseBase.extend({
	transcript: z.string(),
	seconds: z.number().positive(),
	/** optional real recording, relative to fixtures/; only the real backend reads it */
	audio: z.string().min(1).optional()
});

export type TextCase = z.infer<typeof textCaseSchema>;
export type PhotoCase = z.infer<typeof photoCaseSchema>;
export type AudioCase = z.infer<typeof audioCaseSchema>;

export interface Corpus {
	text: TextCase[];
	photo: PhotoCase[];
	audio: AudioCase[];
}

function readCases<T>(file: string, schema: z.ZodType<T>): T[] {
	const path = join(FIXTURE_DIR, file);
	const parsed = z.array(schema).safeParse(JSON.parse(readFileSync(path, 'utf8')));
	if (!parsed.success) {
		const detail = parsed.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ');
		throw new Error(`${file} is not a valid fixture file - ${detail}`);
	}
	return parsed.data;
}

export function loadCorpus(): Corpus {
	return {
		text: readCases('text.json', textCaseSchema),
		photo: readCases('photo.json', photoCaseSchema),
		audio: readCases('audio.json', audioCaseSchema)
	};
}
