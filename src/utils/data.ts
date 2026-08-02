import {
	AUTHORED_SCHEMAS,
	NUDGE_CATEGORIES,
	NUDGE_TYPES,
	type Nudge,
	type NudgeCategory,
	type NudgeType
} from '~/types/nudge';

// lazy so only the active locale's files are ever fetched; eager would bundle
// every language into the entry chunk
const dataModules = import.meta.glob<{ default: unknown[] }>('../data/*/*/*.json');

export interface DataPath {
	locale: string;
	category: NudgeCategory;
	type: NudgeType;
}

const CATEGORIES = new Set<string>(NUDGE_CATEGORIES);
const TYPES = new Set<string>(NUDGE_TYPES);

/** `../data/en/nature/task.json` -> { locale, category, type } */
export function parseDataPath(key: string): DataPath | null {
	const match = /\/data\/([^/]+)\/([^/]+)\/([^/]+)\.json$/.exec(key);
	if (!match) return null;

	const [, locale, category, type] = match as unknown as [string, string, string, string];
	if (!CATEGORIES.has(category) || !TYPES.has(type)) return null;

	return { locale, category: category as NudgeCategory, type: type as NudgeType };
}

/**
 * region -> language -> english. a region file only carries the entries that
 * differ, so everything else falls through to its base language.
 */
export function localeChain(locale: string): string[] {
	const chain: string[] = [];
	const push = (value: string) => {
		if (value && !chain.includes(value)) chain.push(value);
	};

	push(locale);
	const language = locale.split('-')[0];
	if (language) push(language);
	push('en');

	return chain;
}

export function availableLocales(): string[] {
	const locales = new Set<string>();
	for (const key of Object.keys(dataModules)) {
		const parsed = parseDataPath(key);
		if (parsed) locales.add(parsed.locale);
	}
	return [...locales].sort();
}

export function composeNudgeId(category: NudgeCategory, type: NudgeType, slug: string): string {
	return `${category}.${type}.${slug}`;
}

export interface NormalizeIssue {
	path: string;
	index: number;
	message: string;
}

/**
 * Reject a nudge carrying a key no schema declares.
 *
 * zod strips unknown keys instead of rejecting them, and the per-type schemas cannot be
 * made `.strict()` because four of them are `.and()` intersections - a strict left side
 * rejects the right side's own `validation_type` / `validation_data`. So the top level is
 * checked here instead.
 *
 * It matters because the failure is silent and it disables things: `filterz` for `filters`
 * ships a nudge with no permission or model-pack gate at all, and `require_fresh_exiff`
 * inside `validation_data` used to turn EXIF forensics off while CI stayed green. The
 * nested payloads are `.strict()` now; this covers the level above them.
 * `tests/unit/utils/data.spec.ts` asserts this list against the schemas so it cannot drift.
 */
const BASE_KEYS = [
	'id',
	'icon',
	'color',
	'points',
	'filters',
	'tags',
	'duration_minutes',
	'locales',
	'place_affordances'
] as const;

export const AUTHORED_KEYS: Record<NudgeType, readonly string[]> = {
	task: [...BASE_KEYS, 'title', 'description', 'validation_type', 'validation_data'],
	question: [...BASE_KEYS, 'question', 'actions'],
	think: [...BASE_KEYS, 'prompt'],
	choose: [...BASE_KEYS, 'prompt', 'options'],
	create: [...BASE_KEYS, 'prompt', 'validation_type', 'validation_data'],
	notice: [...BASE_KEYS, 'prompt', 'validation_type', 'validation_data'],
	count: [...BASE_KEYS, 'prompt', 'unit', 'validation_type', 'validation_data']
};

export function unknownTopLevelKeys(entry: unknown, type: NudgeType): string[] {
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
	const allowed = new Set(AUTHORED_KEYS[type]);
	return Object.keys(entry as Record<string, unknown>).filter((key) => !allowed.has(key));
}

/**
 * validate one file's worth of authored entries and normalize them. invalid
 * entries are reported and skipped rather than thrown, so one bad nudge cannot
 * blank the whole catalog on a user's device.
 */
export function normalizeFile(
	entries: unknown[],
	path: DataPath,
	sourceKey: string,
	issues: NormalizeIssue[]
): Nudge[] {
	const schema = AUTHORED_SCHEMAS[path.type];
	const out: Nudge[] = [];

	entries.forEach((entry, index) => {
		const unknown = unknownTopLevelKeys(entry, path.type);
		if (unknown.length > 0) {
			issues.push({
				path: sourceKey,
				index,
				message: `unknown key(s): ${unknown.join(', ')}`
			});
			return;
		}

		const parsed = schema.safeParse(entry);
		if (!parsed.success) {
			issues.push({
				path: sourceKey,
				index,
				message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
			});
			return;
		}

		const authored = parsed.data as Record<string, unknown> & { id: string };
		const { filters, tags, ...rest } = authored;

		out.push({
			...rest,
			slug: authored.id,
			id: composeNudgeId(path.category, path.type, authored.id),
			category: path.category,
			type: path.type,
			locale: path.locale,
			filters: (filters as Nudge['filters']) ?? [],
			tags: (tags as string[]) ?? []
		} as Nudge);
	});

	return out;
}

export interface Catalog {
	nudges: Nudge[];
	issues: NormalizeIssue[];
	/** locales actually contributing entries, most specific first */
	chain: string[];
}

/**
 * load every nudge visible to `locale`. later entries in the chain never
 * override earlier ones, so a region overlay wins over its base language for
 * the same composed id.
 */
export async function loadCatalog(locale: string): Promise<Catalog> {
	const chain = localeChain(locale);
	const issues: NormalizeIssue[] = [];
	const byId = new Map<string, Nudge>();

	for (const step of chain) {
		const keys = Object.keys(dataModules).filter((key) => parseDataPath(key)?.locale === step);

		const loaded = await Promise.all(
			keys.map(async (key) => {
				const path = parseDataPath(key)!;
				try {
					const module = await dataModules[key]!();
					const entries = Array.isArray(module.default) ? module.default : [];
					return normalizeFile(entries, path, key, issues);
				} catch (error) {
					issues.push({
						path: key,
						index: -1,
						message: error instanceof Error ? error.message : 'failed to load'
					});
					return [];
				}
			})
		);

		for (const nudge of loaded.flat()) {
			if (!byId.has(nudge.id)) byId.set(nudge.id, nudge);
		}
	}

	const nudges = [...byId.values()].filter((nudge) => isVisibleInLocale(nudge, locale));
	// stable order so a seeded pick is reproducible regardless of glob ordering
	nudges.sort((a, b) => a.id.localeCompare(b.id));

	return { nudges, issues, chain };
}

/** a nudge with `locales` only shows for those locales or their regions */
export function isVisibleInLocale(nudge: Nudge, locale: string): boolean {
	if (!nudge.locales || nudge.locales.length === 0) return true;
	const chain = localeChain(locale);
	return nudge.locales.some((allowed) => chain.includes(allowed));
}

/** every module key, exposed so the data-integrity spec can walk the real tree */
export function dataModuleKeys(): string[] {
	return Object.keys(dataModules).sort();
}
