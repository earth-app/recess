import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * V8 coverage from a real browser, remapped onto `src/*` and emitted as lcov.
 *
 * The unit lane measures what a mounted component decides; this lane measures what actually executes
 * in a browser - Ionic's gestures, the canvas renderer, the router, and every path that only runs
 * once a page is real. Neither subsumes the other, which is why `codecov.yml` carries both flags.
 *
 * Two details are load-bearing and both cost a full CI run to learn:
 *
 * - The served chunk is minified, so coverage means nothing until it is remapped through the
 *   `.js.map` beside it on disk. That is why `nuxt.config.ts` emits client sourcemaps for test
 *   builds only, and why the chunk name from the URL has to be resolved back to `dist/_nuxt`.
 * - `v8-to-istanbul` keys coverage by absolute on-disk path, and Codecov matches onto the repo tree
 *   by repo-relative path. An absolute CI path matches nothing, and the whole report is discarded as
 *   unusable rather than reported as empty.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '../../..');

const RAW_DIR = resolve(PROJECT_ROOT, '.coverage', 'raw');
const OUT_DIR = resolve(PROJECT_ROOT, 'coverage');
// `dist` is a symlink to `.output/public`, so the static chunks land here
const CHUNK_DIR = resolve(PROJECT_ROOT, 'dist/_nuxt');

// what survives the remap: app source, not vendor or the nuxt runtime
const KEEP_PREFIXES = [
	'src/',
	'/src/',
	'pages/',
	'components/',
	'composables/',
	'stores/',
	'utils/'
];

function isCandidateUrl(url: string): boolean {
	if (!url) return false;
	if (url.includes('node_modules')) return false;
	if (url.startsWith('data:')) return false;
	if (url.startsWith('chrome-extension:')) return false;
	if (url.includes('hot-update')) return false;
	// the build manifest, not app code
	if (url.includes('/_nuxt/builds/')) return false;

	const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3001';
	return url.startsWith(`${base}/`) || url.includes('/_nuxt/');
}

function isAppSourcePath(filePath: string): boolean {
	if (!filePath) return false;
	if (filePath.includes('node_modules')) return false;
	if (filePath.includes('/stubs/')) return false;
	return KEEP_PREFIXES.some((prefix) => filePath.includes(prefix));
}

/** repo-relative, because an absolute path makes codecov reject the report outright */
export function toRepoRelative(filePath: string): string {
	if (!filePath) return filePath;

	const root = PROJECT_ROOT.endsWith('/') ? PROJECT_ROOT : `${PROJECT_ROOT}/`;
	if (filePath.startsWith(root)) return filePath.slice(root.length);

	// handles a symlinked or otherwise non-root-prefixed path
	const match = filePath.match(/(?:^|\/)(src\/.*)$/);
	return match?.[1] ?? filePath;
}

export interface V8Entry {
	url: string;
	source: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	functions: any[];
}

/** one file per test, so parallel workers never contend */
export async function saveCoverageForTest(
	testId: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	entries: Array<{ url: string; source?: string; functions: any[] }>
): Promise<void> {
	if (entries.length === 0) return;

	const usable = entries.filter((entry) => entry.source && isCandidateUrl(entry.url));
	if (usable.length === 0) return;

	if (!existsSync(RAW_DIR)) await mkdir(RAW_DIR, { recursive: true });
	await writeFile(resolve(RAW_DIR, `${testId}.json`), JSON.stringify(usable), 'utf8');
}

/** merge every raw file into istanbul shape and write the three reports codecov reads */
export async function mergeAndReport(): Promise<void> {
	if (!existsSync(RAW_DIR)) {
		console.log('[coverage] no raw coverage to report');
		return;
	}

	const files = (await readdir(RAW_DIR)).filter((name) => name.endsWith('.json'));
	if (files.length === 0) {
		console.log('[coverage] no raw coverage files found');
		return;
	}

	const module = await import(
		pathToFileURL(resolve(PROJECT_ROOT, 'node_modules/v8-to-istanbul/index.js')).href
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	).catch(() => import('v8-to-istanbul') as any);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const v8toIstanbul = (module as any).default ?? (module as any);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const merged: Record<string, any> = {};

	for (const file of files) {
		const raw = JSON.parse(await readFile(resolve(RAW_DIR, file), 'utf8')) as V8Entry[];

		for (const entry of raw) {
			try {
				/*
				 * The served url (`http://127.0.0.1:3003/_nuxt/abc.js`) maps to a chunk on disk whose
				 * `.js.map` is what carries the remap. An html entry has no `/_nuxt/` segment and no
				 * sourcemap, so it converts in source-only mode and drops out at the keep filter.
				 */
				const chunk = entry.url.match(/\/_nuxt\/([^/?#]+\.js)(?:[?#]|$)/)?.[1];
				const converter = v8toIstanbul(chunk ? resolve(CHUNK_DIR, chunk) : '', 0, {
					source: entry.source
				});

				await converter.load();
				converter.applyCoverage(entry.functions);

				for (const [filePath, fileCoverage] of Object.entries(converter.toIstanbul())) {
					if (!isAppSourcePath(filePath)) continue;

					const relative = toRepoRelative(filePath);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(fileCoverage as any).path = relative;

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					if (merged[relative]) mergeFileCoverage(merged[relative], fileCoverage as any);
					else merged[relative] = fileCoverage;
				}

				converter.destroy();
			} catch (error) {
				console.warn(`[coverage] failed to convert ${entry.url}:`, (error as Error).message);
			}
		}
	}

	if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

	await writeFile(resolve(OUT_DIR, 'coverage-final.json'), JSON.stringify(merged, null, 2));
	await writeFile(resolve(OUT_DIR, 'lcov.info'), toLcov(merged));

	const summary = toSummary(merged);
	await writeFile(resolve(OUT_DIR, 'coverage-summary.json'), JSON.stringify(summary, null, 2));

	const { statements, branches, functions, lines } = summary.total;
	console.log(`[coverage] ${Object.keys(merged).length} files, reports written to ${OUT_DIR}/`);
	console.log(
		`[coverage] statements: ${statements.pct}%  branches: ${branches.pct}%  ` +
			`functions: ${functions.pct}%  lines: ${lines.pct}%`
	);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** counts add, because the same chunk is exercised by many tests */
export function mergeFileCoverage(target: any, source: any): void {
	for (const [key, value] of Object.entries(source.s as Record<string, number>)) {
		target.s[key] = (target.s[key] ?? 0) + value;
	}
	for (const [key, value] of Object.entries(source.f as Record<string, number>)) {
		target.f[key] = (target.f[key] ?? 0) + value;
	}
	for (const [key, value] of Object.entries(source.b as Record<string, number[]>)) {
		const existing = target.b[key] as number[] | undefined;
		target.b[key] = existing ? existing.map((n, i) => n + (value[i] ?? 0)) : [...value];
	}
}

export function toLcov(merged: Record<string, any>): string {
	let out = '';

	for (const [filePath, cov] of Object.entries(merged)) {
		out += `TN:\nSF:${filePath}\n`;

		for (const fn of Object.values(cov.fnMap as Record<string, any>)) {
			out += `FN:${fn.decl.start.line},${fn.name || '(anonymous)'}\n`;
		}

		let functionsHit = 0;
		for (const [id, count] of Object.entries(cov.f as Record<string, number>)) {
			const fn = cov.fnMap[id];
			if (!fn) continue;
			out += `FNDA:${count},${fn.name || '(anonymous)'}\n`;
			if (count > 0) functionsHit++;
		}
		out += `FNF:${Object.keys(cov.f).length}\nFNH:${functionsHit}\n`;

		// lcov is line based, so several statements on one line collapse into one count
		const lineCounts: Record<number, number> = {};
		for (const [id, count] of Object.entries(cov.s as Record<string, number>)) {
			const statement = cov.statementMap[id];
			if (!statement) continue;
			const line = statement.start.line;
			lineCounts[line] = (lineCounts[line] ?? 0) + count;
		}

		let linesHit = 0;
		for (const [line, count] of Object.entries(lineCounts)) {
			out += `DA:${line},${count}\n`;
			if (count > 0) linesHit++;
		}
		out += `LF:${Object.keys(lineCounts).length}\nLH:${linesHit}\n`;

		let branchesHit = 0;
		let branchesTotal = 0;
		for (const [id, counts] of Object.entries(cov.b as Record<string, number[]>)) {
			const branch = cov.branchMap[id];
			if (!branch) continue;
			for (let index = 0; index < counts.length; index++) {
				out += `BRDA:${branch.line},${id},${index},${counts[index]}\n`;
				branchesTotal++;
				if ((counts[index] ?? 0) > 0) branchesHit++;
			}
		}
		out += `BRF:${branchesTotal}\nBRH:${branchesHit}\n`;

		out += 'end_of_record\n';
	}

	return out;
}

interface SummaryEntry {
	total: number;
	covered: number;
	skipped: number;
	pct: number;
}

export function toSummary(merged: Record<string, any>): {
	total: Record<'statements' | 'functions' | 'branches' | 'lines', SummaryEntry>;
} {
	const totals = {
		statements: 0,
		statementsHit: 0,
		functions: 0,
		functionsHit: 0,
		branches: 0,
		branchesHit: 0,
		lines: 0,
		linesHit: 0
	};

	for (const cov of Object.values(merged)) {
		const statements = Object.values(cov.s) as number[];
		totals.statements += statements.length;
		totals.statementsHit += statements.filter((n) => n > 0).length;

		const functions = Object.values(cov.f) as number[];
		totals.functions += functions.length;
		totals.functionsHit += functions.filter((n) => n > 0).length;

		for (const counts of Object.values(cov.b as Record<string, number[]>)) {
			totals.branches += counts.length;
			totals.branchesHit += counts.filter((n) => n > 0).length;
		}

		// deduplicated by line, to match the DA records lcov emits
		const seen = new Set<number>();
		const hit = new Set<number>();
		for (const [id, count] of Object.entries(cov.s as Record<string, number>)) {
			const statement = cov.statementMap[id];
			if (!statement) continue;
			seen.add(statement.start.line);
			if (count > 0) hit.add(statement.start.line);
		}
		totals.lines += seen.size;
		totals.linesHit += hit.size;
	}

	// an empty report is 100%, not 0%, so a skipped lane cannot fail the project target
	const pct = (covered: number, total: number) =>
		total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100;
	const entry = (total: number, covered: number): SummaryEntry => ({
		total,
		covered,
		skipped: 0,
		pct: pct(covered, total)
	});

	return {
		total: {
			statements: entry(totals.statements, totals.statementsHit),
			functions: entry(totals.functions, totals.functionsHit),
			branches: entry(totals.branches, totals.branchesHit),
			lines: entry(totals.lines, totals.linesHit)
		}
	};
}

/* eslint-enable @typescript-eslint/no-explicit-any */

if (import.meta.url === `file://${process.argv[1]}`) {
	mergeAndReport().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
