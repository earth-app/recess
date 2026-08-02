import { describe, expect, it } from 'vitest';
import {
	AUTHORED_SCHEMAS,
	NUDGE_CATEGORIES,
	NUDGE_TYPES,
	VALIDATION_PACK,
	isValidated,
	nudgeTitle,
	type Nudge,
	type NudgeFilter,
	type NudgeFilterType,
	type NudgePermission,
	type NudgeType,
	type ValidationType
} from '~/types/nudge';
import { colorAliases } from '~/utils/color';
import {
	AUTHORED_KEYS,
	availableLocales,
	composeNudgeId,
	dataModuleKeys,
	isVisibleInLocale,
	loadCatalog,
	localeChain,
	normalizeFile,
	parseDataPath
} from '~/utils/data';
import { think } from '../helpers';

type Issues = Parameters<typeof normalizeFile>[3];

/** `find` on a discriminated union does not narrow on its own */
function findFilter<T extends NudgeFilterType>(nudge: Nudge, type: T) {
	return nudge.filters.find(
		(filter): filter is Extract<NudgeFilter, { type: T }> => filter.type === type
	);
}

/** both CLIP arrays live on the same payload and are fed to the same model */
interface ClipLabels {
	labels?: string[];
	negative_labels?: string[];
}

describe('parseDataPath', () => {
	it('splits a valid data path', () => {
		expect(parseDataPath('../data/en/nature/task.json')).toEqual({
			locale: 'en',
			category: 'nature',
			type: 'task'
		});
	});

	it('accepts a region locale', () => {
		expect(parseDataPath('../data/es-MX/cooking/notice.json')?.locale).toBe('es-MX');
	});

	it('rejects an unknown category or type', () => {
		expect(parseDataPath('../data/en/spaceships/task.json')).toBeNull();
		expect(parseDataPath('../data/en/nature/singing.json')).toBeNull();
	});

	it('rejects a path that is not a data file', () => {
		expect(parseDataPath('../data/colors.json')).toBeNull();
		expect(parseDataPath('nonsense')).toBeNull();
	});
});

describe('localeChain', () => {
	it('walks region to language to english', () => {
		expect(localeChain('es-MX')).toEqual(['es-MX', 'es', 'en']);
		expect(localeChain('en-GB')).toEqual(['en-GB', 'en']);
	});

	it('does not repeat english', () => {
		expect(localeChain('en')).toEqual(['en']);
	});

	it('always ends at english for an unknown locale', () => {
		expect(localeChain('fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
	});
});

describe('composeNudgeId', () => {
	it('joins category, type and slug', () => {
		expect(composeNudgeId('nature', 'notice', 'first_bird')).toBe('nature.notice.first_bird');
	});
});

describe('isVisibleInLocale', () => {
	it('is visible everywhere with no restriction', () => {
		expect(isVisibleInLocale(think(), 'es-MX')).toBe(true);
	});

	it('honours a language restriction for its regions', () => {
		const nudge = think({ locales: ['es'] });
		expect(isVisibleInLocale(nudge, 'es-MX')).toBe(true);
		expect(isVisibleInLocale(nudge, 'en')).toBe(false);
	});

	it('honours an exact region restriction', () => {
		const nudge = think({ locales: ['en-GB'] });
		expect(isVisibleInLocale(nudge, 'en-GB')).toBe(true);
		expect(isVisibleInLocale(nudge, 'en')).toBe(false);
	});
});

describe('normalizeFile', () => {
	const path = { locale: 'en', category: 'nature' as const, type: 'think' as const };

	it('composes the id and injects the path metadata', () => {
		const issues: Parameters<typeof normalizeFile>[3] = [];
		const [nudge] = normalizeFile(
			[
				{ id: 'first_bird', icon: 'mdi:bird', color: '@green', points: 5, prompt: 'Notice a bird.' }
			],
			path,
			'test.json',
			issues
		);
		expect(nudge?.id).toBe('nature.think.first_bird');
		expect(nudge?.slug).toBe('first_bird');
		expect(nudge?.category).toBe('nature');
		expect(nudge?.type).toBe('think');
		expect(nudge?.locale).toBe('en');
		expect(issues).toEqual([]);
	});

	it('defaults filters and tags to empty arrays', () => {
		const [nudge] = normalizeFile(
			[{ id: 'x', icon: 'mdi:bird', color: '@green', points: 5, prompt: 'x' }],
			path,
			'test.json',
			[]
		);
		expect(nudge?.filters).toEqual([]);
		expect(nudge?.tags).toEqual([]);
	});

	it('skips an invalid entry and reports it rather than throwing', () => {
		const issues: Parameters<typeof normalizeFile>[3] = [];
		const result = normalizeFile(
			[
				{ id: 'good', icon: 'mdi:bird', color: '@green', points: 5, prompt: 'ok' },
				{ id: 'BAD SLUG', icon: 'mdi:bird', color: '@green', points: 5, prompt: 'nope' }
			],
			path,
			'test.json',
			issues
		);
		expect(result).toHaveLength(1);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.index).toBe(1);
	});

	it('reports the offending field in the issue message', () => {
		const issues: Parameters<typeof normalizeFile>[3] = [];
		normalizeFile(
			[{ id: 'x', icon: 'mdi:bird', color: 'not-a-color', points: 5, prompt: 'x' }],
			path,
			'test.json',
			issues
		);
		expect(issues[0]?.message).toContain('color');
	});
});

describe('the shipped catalog', () => {
	it('has a file for at least one type in every category', async () => {
		const keys = dataModuleKeys();
		for (const category of NUDGE_CATEGORIES) {
			expect(
				keys.some((key) => parseDataPath(key)?.category === category),
				`${category} has no data files`
			).toBe(true);
		}
	});

	it('only contains recognised locales, categories and types', () => {
		for (const key of dataModuleKeys()) {
			const parsed = parseDataPath(key);
			expect(parsed, `${key} is not a valid data path`).not.toBeNull();
			expect(NUDGE_CATEGORIES).toContain(parsed!.category);
			expect(NUDGE_TYPES).toContain(parsed!.type);
		}
	});

	it('ships english', () => {
		expect(availableLocales()).toContain('en');
	});

	it('loads english with no schema violations', async () => {
		const { nudges, issues } = await loadCatalog('en');
		expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
		expect(nudges.length).toBeGreaterThan(0);
	});

	it('has globally unique ids', async () => {
		const { nudges } = await loadCatalog('en');
		const seen = new Map<string, number>();
		for (const nudge of nudges) seen.set(nudge.id, (seen.get(nudge.id) ?? 0) + 1);
		expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
	});

	it('gives every nudge a non-empty headline', async () => {
		const { nudges } = await loadCatalog('en');
		for (const nudge of nudges) {
			expect(nudgeTitle(nudge).trim().length, nudge.id).toBeGreaterThan(0);
		}
	});

	it('gives every validated nudge the data its validator needs', async () => {
		const { nudges } = await loadCatalog('en');
		for (const nudge of nudges.filter(isValidated)) {
			if (nudge.validation_type === 'confirm') continue;
			expect(nudge.validation_data, `${nudge.id} has no validation_data`).toBeTruthy();
		}
	});

	it('keeps every rubric summing to 1.0', async () => {
		const { nudges } = await loadCatalog('en');
		for (const nudge of nudges.filter(isValidated)) {
			const data = nudge.validation_data as { rubric?: { weight: number }[] } | undefined;
			if (!data?.rubric) continue;
			const total = data.rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
			expect(Math.abs(total - 1), `${nudge.id} rubric sums to ${total}`).toBeLessThanOrEqual(0.001);
		}
	});

	it('phrases every CLIP label and decoy in english as a photo prompt', async () => {
		for (const locale of availableLocales()) {
			const { nudges } = await loadCatalog(locale);

			for (const nudge of nudges.filter(isValidated)) {
				const data = nudge.validation_data as ClipLabels | undefined;

				for (const label of data?.labels ?? []) {
					expect(label, `${locale} ${nudge.id} label should read as a photo prompt`).toMatch(
						/^a (photo|picture|drawing) of \S/i
					);
				}

				// decoys add `screenshot`, which is how a photographed screen gets scored down
				for (const label of data?.negative_labels ?? []) {
					expect(
						label,
						`${locale} ${nudge.id} negative label should read as a photo prompt`
					).toMatch(/^a (photo|picture|drawing|screenshot) of \S/i);
				}
			}
		}
	});

	it('resolves every authored @alias against colors.json', async () => {
		// an unknown alias is not an error anywhere at runtime; resolveColor just
		// falls back, so the nudge ships rendering the default green
		const aliases = Object.keys(colorAliases());

		for (const locale of availableLocales()) {
			const { nudges } = await loadCatalog(locale);

			for (const nudge of nudges) {
				const tokens = [nudge.color];
				if (nudge.type === 'question') tokens.push(...nudge.actions.map((action) => action.color));
				if (nudge.type === 'choose') tokens.push(...nudge.options.map((option) => option.color));

				for (const token of tokens) {
					if (!token.startsWith('@')) continue;
					expect(aliases, `${locale} ${nudge.id} uses unknown ${token}`).toContain(token.slice(1));
				}
			}
		}
	});

	it('gives every photo nudge something for the score to compete against', async () => {
		const { nudges } = await loadCatalog('en');
		for (const nudge of nudges.filter(isValidated)) {
			if (nudge.validation_type !== 'photo') continue;
			const data = nudge.validation_data as { negative_labels?: string[] };
			expect(
				data.negative_labels?.length ?? 0,
				`${nudge.id} has no negative labels`
			).toBeGreaterThan(0);
		}
	});

	it('keeps thresholds inside the useful band', async () => {
		const { nudges } = await loadCatalog('en');
		for (const nudge of nudges.filter(isValidated)) {
			const data = nudge.validation_data as { threshold?: number } | undefined;
			if (data?.threshold === undefined) continue;
			const normalized = data.threshold > 1 ? data.threshold / 100 : data.threshold;
			// unrelated content floors near 0.5, so anything below that accepts everything
			expect(
				normalized,
				`${nudge.id} threshold is too low to mean anything`
			).toBeGreaterThanOrEqual(0.5);
			expect(normalized, `${nudge.id} threshold is unreachable`).toBeLessThanOrEqual(0.9);
		}
	});

	it('points every leads_to at a nudge that exists', async () => {
		const { nudges } = await loadCatalog('en');
		const ids = new Set(nudges.map((nudge) => nudge.id));
		for (const nudge of nudges) {
			if (nudge.type !== 'question') continue;
			for (const action of nudge.actions) {
				if (!action.leads_to) continue;
				expect(ids.has(action.leads_to), `${nudge.id} leads to missing ${action.leads_to}`).toBe(
					true
				);
			}
		}
	});

	it('points every completed filter at a nudge that exists', async () => {
		const { nudges } = await loadCatalog('en');
		const ids = new Set(nudges.map((nudge) => nudge.id));
		for (const nudge of nudges) {
			for (const filter of nudge.filters) {
				if (filter.type !== 'completed') continue;
				for (const target of [...(filter.value.is ?? []), ...(filter.value.is_not ?? [])]) {
					expect(ids.has(target), `${nudge.id} references missing ${target}`).toBe(true);
				}
			}
		}
	});

	it('declares the model pack its validator needs, in every locale', async () => {
		// the recommender only down-weights a nudge whose pack is absent, so without this
		// filter the nudge is served to an install that cannot score it
		for (const locale of availableLocales()) {
			const { nudges } = await loadCatalog(locale);

			for (const nudge of nudges.filter(isValidated)) {
				const required = VALIDATION_PACK[nudge.validation_type];
				if (!required) continue;

				const pack = findFilter(nudge, 'model_pack');
				expect(pack, `${locale} ${nudge.id} has no model_pack filter`).toBeDefined();

				// model_pack is AND, so listing only `audio` would let the nudge surface
				// without the embedder that actually scores the transcript
				const expected = nudge.validation_type === 'audio' ? ['audio', 'text'] : [required];
				expect(
					[...(pack?.value.is ?? [])].sort(),
					`${locale} ${nudge.id} declares the wrong packs`
				).toEqual(expected.sort());
			}
		}
	});

	it('declares the permission its capture step needs, in every locale', async () => {
		// no permission filter means the nudge can surface on an install that will
		// never be able to open the camera or the recorder for it
		const needs: Partial<Record<ValidationType, NudgePermission>> = {
			photo: 'camera',
			barcode: 'camera',
			audio: 'microphone'
		};

		for (const locale of availableLocales()) {
			const { nudges } = await loadCatalog(locale);

			for (const nudge of nudges.filter(isValidated)) {
				const required = needs[nudge.validation_type];
				if (!required) continue;

				const permission = findFilter(nudge, 'permission');
				expect(permission, `${locale} ${nudge.id} has no permission filter`).toBeDefined();
				expect(
					permission?.value.is ?? [],
					`${locale} ${nudge.id} is ${nudge.validation_type} and needs ${required}`
				).toContain(required);
			}
		}
	});

	it('makes every audio nudge ask the user to speak', async () => {
		// validateAudio transcribes first and returns `missed` on an empty transcript,
		// so an ambient-only recording nudge is unpassable by construction
		const { nudges } = await loadCatalog('en');

		for (const nudge of nudges.filter(isValidated)) {
			if (nudge.validation_type !== 'audio') continue;

			const text = (nudge.type === 'task' ? nudge.description : nudge.prompt).toLowerCase();
			expect(text, `${nudge.id} never asks the user to speak`).toMatch(
				/\b(say|said|tell|describe|explain|name|talk|speak|read)\b/
			);
		}
	});

	it('sorts deterministically so a seeded pick is reproducible', async () => {
		const first = await loadCatalog('en');
		const second = await loadCatalog('en');
		expect(second.nudges.map((n) => n.id)).toEqual(first.nudges.map((n) => n.id));
	});

	it('falls back to english for a locale with no tree of its own', async () => {
		const { nudges } = await loadCatalog('fr');
		expect(nudges.length).toBeGreaterThan(0);
	});
});

describe('locale trees', () => {
	it('mirrors every english nudge id in spanish', async () => {
		const en = await loadCatalog('en');
		const es = await loadCatalog('es');

		// comparing resolved ids cannot fail: the es->en chain backfills any gap, so
		// a half-finished tree would still match. compare what es itself authored.
		const authored = new Set(es.nudges.filter((n) => n.locale === 'es').map((n) => n.id));
		const expected = new Set(en.nudges.map((n) => n.id));

		const missing = [...expected].filter((id) => !authored.has(id)).sort();
		expect(missing, `${missing.length} english nudges have no spanish entry`).toEqual([]);
	});

	it('loads spanish with no schema violations', async () => {
		const { issues } = await loadCatalog('es');
		expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
	});

	it('loads every region overlay with no schema violations', async () => {
		// nothing else validates these: normalizeFile skips a bad entry and loadCatalog then
		// backfills it from the base language, so the override silently stops applying
		for (const locale of ['en-GB', 'es-MX']) {
			const { issues } = await loadCatalog(locale);
			expect(issues, `${locale} ${JSON.stringify(issues, null, 2)}`).toEqual([]);
		}
	});

	it('keeps CLIP labels and decoys in english in every locale, since CLIP is english-only', async () => {
		const en = await loadCatalog('en');
		const byId = new Map(en.nudges.map((n) => [n.id, n]));

		for (const locale of availableLocales().filter((candidate) => candidate !== 'en')) {
			const { nudges } = await loadCatalog(locale);

			// an entry with no file of its own IS the english object, so comparing it to itself
			// proves nothing. only what this locale authored can actually have drifted.
			for (const nudge of nudges.filter((n) => n.locale === locale)) {
				const data = (nudge as { validation_data?: ClipLabels }).validation_data;
				if (!data) continue;

				const source = (byId.get(nudge.id) as { validation_data?: ClipLabels } | undefined)
					?.validation_data;
				expect(data.labels, `${locale} ${nudge.id} labels drifted from english`).toEqual(
					source?.labels
				);
				expect(
					data.negative_labels,
					`${locale} ${nudge.id} negative labels drifted from english`
				).toEqual(source?.negative_labels);
			}
		}
	});

	it('keeps a region overlay from changing behaviour, only wording', async () => {
		// an overlay entry replaces the base entry whole rather than patching it, so a
		// retagged override drops the base tag and can collide with a sibling nudge
		const behaviour = ['tags', 'filters', 'points', 'duration_minutes', 'locales'] as const;

		for (const [region, base] of Object.entries({ 'en-GB': 'en', 'es-MX': 'es' })) {
			const overlay = await loadCatalog(region);
			const byId = new Map((await loadCatalog(base)).nudges.map((n) => [n.id, n]));

			for (const nudge of overlay.nudges.filter((n) => n.locale === region)) {
				const source = byId.get(nudge.id);
				for (const key of behaviour) {
					expect(nudge[key], `${region} ${nudge.id} overrides ${key}`).toEqual(source?.[key]);
				}
			}
		}
	});

	it('only lets a region overlay override ids that exist in its base language', async () => {
		const bases: Record<string, string> = { 'en-GB': 'en', 'es-MX': 'es' };

		for (const [region, base] of Object.entries(bases)) {
			const regionKeys = dataModuleKeys().filter((key) => parseDataPath(key)?.locale === region);
			if (regionKeys.length === 0) continue;

			const baseIds = new Set((await loadCatalog(base)).nudges.map((n) => n.id));
			const overlay = await loadCatalog(region);

			for (const nudge of overlay.nudges) {
				// an overlay entry whose id is absent from the base is almost always a typo
				expect(baseIds.has(nudge.id), `${region} overrides unknown ${nudge.id}`).toBe(true);
			}
		}
	});

	it('lets a region overlay actually win over its base language', async () => {
		const en = await loadCatalog('en');
		const gb = await loadCatalog('en-GB');

		const enChoose = en.nudges.find((n) => n.id === 'exercise.choose.stairs_or_lift');
		const gbChoose = gb.nudges.find((n) => n.id === 'exercise.choose.stairs_or_lift');

		expect(enChoose).toBeDefined();
		expect(gbChoose).toBeDefined();
		expect(gbChoose?.locale).toBe('en-GB');
		expect((gbChoose as { prompt: string }).prompt).not.toBe(
			(enChoose as { prompt: string }).prompt
		);
	});

	it('keeps every non-english locale free of em dashes and curly quotes', async () => {
		for (const locale of ['es', 'es-MX', 'en-GB']) {
			const { nudges } = await loadCatalog(locale);
			const serialized = JSON.stringify(nudges);
			expect(serialized, `${locale} contains an em dash`).not.toMatch(/—/);
			expect(serialized, `${locale} contains a curly quote`).not.toMatch(/[‘’“”]/);
		}
	});
});

describe('AUTHORED_KEYS', () => {
	interface SchemaDef {
		type?: string;
		left?: unknown;
		right?: unknown;
		options?: unknown[];
	}

	// the list is hand-maintained because zod strips unknown keys and the `.and()`
	// intersections cannot be `.strict()`; walking the schemas is what pins the two together
	function schemaKeys(schema: unknown): string[] {
		const def = (schema as { _zod?: { def?: SchemaDef } })?._zod?.def;
		if (!def) return [];
		if (def.type === 'object') return Object.keys((schema as { shape: object }).shape);
		if (def.type === 'intersection') return [...schemaKeys(def.left), ...schemaKeys(def.right)];
		if (def.type === 'union') return (def.options ?? []).flatMap(schemaKeys);
		return [];
	}

	const base = {
		id: 'sample',
		icon: 'mdi:leaf',
		color: '@green',
		points: 5,
		filters: [{ type: 'time_of_day', value: { is: ['day'] } }],
		tags: ['sample'],
		duration_minutes: 5,
		locales: ['en'],
		place_affordances: ['sit']
	};

	const photo = {
		validation_type: 'photo',
		validation_data: {
			labels: ['a photo of a sample'],
			negative_labels: ['a screenshot of a screen'],
			threshold: 0.6,
			require_fresh_exif: true
		}
	};

	/** one entry per type using every key that type is allowed to author */
	const samples: Record<NudgeType, Record<string, unknown>> = {
		task: {
			...base,
			title: 'A Sample Task',
			description: 'Something worth doing.',
			validation_type: 'text',
			validation_data: {
				rubric: [{ id: 'only', weight: 1, ideal: 'A sentence long enough to score against.' }],
				threshold: 0.7,
				min_length: 50,
				max_length: 800
			}
		},
		question: {
			...base,
			question: 'Which one?',
			actions: [
				{ label: 'This', color: '@green', icon: 'mdi:check', leads_to: 'nature.think.other' },
				{ label: 'That', color: '@red' }
			]
		},
		think: { ...base, prompt: 'Think about it.' },
		choose: {
			...base,
			prompt: 'Pick one.',
			options: [
				{ text: 'This', color: '@green', icon: 'mdi:check' },
				{ text: 'That', color: '@red' }
			]
		},
		create: { ...base, prompt: 'Make something.', ...photo },
		notice: { ...base, prompt: 'Notice something.', ...photo },
		count: {
			...base,
			prompt: 'Count them.',
			unit: 'things',
			validation_type: 'count',
			validation_data: { min: 0, max: 5 }
		}
	};

	const pathFor = (type: NudgeType) => ({ locale: 'en', category: 'nature' as const, type });

	it('lists exactly the keys its type schema accepts', () => {
		for (const type of NUDGE_TYPES) {
			const fromSchema = [...new Set(schemaKeys(AUTHORED_SCHEMAS[type]))].sort();
			expect(fromSchema.length, `${type} schema walk found nothing`).toBeGreaterThan(0);
			expect([...AUTHORED_KEYS[type]].sort(), `${type} drifted from its schema`).toEqual(
				fromSchema
			);
		}
	});

	it('accepts an entry that uses every key its type declares', () => {
		for (const type of NUDGE_TYPES) {
			expect(Object.keys(samples[type]).sort(), `${type} sample is not exhaustive`).toEqual(
				[...AUTHORED_KEYS[type]].sort()
			);

			const issues: Issues = [];
			const [nudge] = normalizeFile([samples[type]], pathFor(type), 'sample.json', issues);
			expect(issues, `${type} ${JSON.stringify(issues)}`).toEqual([]);
			expect(nudge, `${type} sample was skipped`).toBeDefined();
		}
	});

	it('rejects an entry carrying a key no schema declares', () => {
		for (const type of NUDGE_TYPES) {
			const issues: Issues = [];
			const result = normalizeFile(
				[{ ...samples[type], filterz: [] }],
				pathFor(type),
				'sample.json',
				issues
			);
			expect(result, `${type} accepted an unknown key`).toHaveLength(0);
			expect(issues[0]?.message, `${type} did not name the offending key`).toContain('filterz');
		}
	});
});
