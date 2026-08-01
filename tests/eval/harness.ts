import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const EVAL_DIR = import.meta.dir;
const SRC_DIR = resolve(EVAL_DIR, '../../src');
const HARNESS = resolve(EVAL_DIR, 'harness.ts');

type GlobEntry = () => Promise<{ default: unknown[] }>;

/**
 * Vite's `import.meta.glob`, reimplemented on `Bun.Glob`. `src/utils/data.ts` calls
 * it at module scope, so the real `loadCatalog` cannot load under bun without it.
 * Keys keep the pattern's relative form because `parseDataPath` reads them.
 */
export function evalGlob(fromDir: string, pattern: string): Record<string, GlobEntry> {
	const firstStar = pattern.indexOf('*');
	if (firstStar < 0) throw new Error(`eval glob shim expected a wildcard in ${pattern}`);

	const cut = pattern.lastIndexOf('/', firstStar) + 1;
	const prefix = pattern.slice(0, cut);
	const tail = pattern.slice(cut);
	const base = resolve(fromDir, prefix);

	const entries: Record<string, GlobEntry> = {};
	for (const hit of new Bun.Glob(tail).scanSync({ cwd: base })) {
		const file = resolve(base, hit);
		entries[`${prefix}${hit.replaceAll('\\', '/')}`] = () =>
			import(file) as Promise<{ default: unknown[] }>;
	}
	return entries;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteSource(source: string, path: string): string {
	const aliased = source
		.replaceAll("from '~/", `from '${SRC_DIR}/`)
		.replaceAll("import('~/", `import('${SRC_DIR}/`);

	if (!aliased.includes('import.meta.glob')) return aliased;

	const globbed = aliased.replace(
		/import\.meta\.glob\s*(?:<[^>]*>)?\s*\(/g,
		`__evalGlob('${dirname(path)}', `
	);
	if (globbed.includes('import.meta.glob')) {
		throw new Error(`${path} calls import.meta.glob in a shape the eval shim cannot rewrite`);
	}

	return `import { evalGlob as __evalGlob } from '${HARNESS}';\n${globbed}`;
}

let installed = false;

/**
 * bun reads tsconfig `paths` from the importer's nearest tsconfig, and the repo root
 * one carries none, so `~/` inside `src` never resolves. Rewrite it at load time.
 * Every src module therefore has to be reached by dynamic import, because static
 * imports are resolved before this runs.
 */
export function installSourceResolver() {
	if (installed) return;
	installed = true;

	const filter = new RegExp(`^${escapeRegExp(SRC_DIR)}/.*\\.ts$`);
	Bun.plugin({
		name: 'recess-eval-src',
		setup(build) {
			build.onLoad({ filter }, (args) => ({
				contents: rewriteSource(readFileSync(args.path, 'utf8'), args.path),
				loader: 'ts'
			}));
		}
	});
}

export interface Sources {
	validate: typeof import('~/utils/validate');
	rubric: typeof import('~/utils/rubric');
	ml: typeof import('~/utils/ml');
	tiers: typeof import('~/utils/tiers');
	data: typeof import('~/utils/data');
	nudge: typeof import('~/types/nudge');
}

/** the shipped modules under test, loaded through the alias rewriter */
export async function loadSources(): Promise<Sources> {
	installSourceResolver();

	const [validate, rubric, ml, tiers, data, nudge] = await Promise.all([
		import('~/utils/validate'),
		import('~/utils/rubric'),
		import('~/utils/ml'),
		import('~/utils/tiers'),
		import('~/utils/data'),
		import('~/types/nudge')
	]);

	return { validate, rubric, ml, tiers, data, nudge };
}

export type PackBytesLookup = (repo: string, dtype: string) => Promise<number | null>;

export type PackBytesSource =
	{ ok: true; fetchPackBytes: PackBytesLookup } | { ok: false; reason: string };

/**
 * `fetchPackBytes` lives beside Capacitor imports, so it may not load outside a
 * browser. The caller prints "unavailable" with this reason rather than guessing a
 * size.
 */
export async function loadPackBytes(): Promise<PackBytesSource> {
	installSourceResolver();
	try {
		const mod = await import('~/composables/useModels');
		if (typeof mod.fetchPackBytes !== 'function') {
			return { ok: false, reason: 'useModels no longer exports fetchPackBytes' };
		}
		return { ok: true, fetchPackBytes: mod.fetchPackBytes };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'import failed';
		return { ok: false, reason: `useModels is not importable here: ${message}` };
	}
}
