/**
 * Cut an area pack from OpenStreetMap.
 *
 * This is a build-time developer tool, not something the app ever runs. That distinction is the
 * whole reason it exists: the Overpass maintainers name "setting up an app for more than just OSM
 * mappers and relying on the public instances as backend" as problematic use, and Nominatim's
 * policy caps an entire application at one request per second and points at extracts instead. So
 * the app ships a baked pack and never talks to either service.
 *
 * Usage:
 *   bun run scripts/build-area-pack.ts --id us-il-chicago --label "Chicago" \
 *     --bbox -87.75,41.83,-87.55,41.95 [--out src/data/areas]
 *
 * For anything larger than a city, prefer a Geofabrik extract piped through
 * `osmium extract --polygon` and `osmium tags-filter` rather than Overpass.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { TAG_AFFORDANCES, type AreaPack, type PackedPlace } from '../src/types/places';
import { snapToGrid } from '../src/utils/geo';
import { affordancesForTags, isPublic } from '../src/utils/places';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const ATTRIBUTION = 'Map data from OpenStreetMap contributors, licensed under the ODbL';

interface Args {
	id: string;
	label: string;
	bbox: [number, number, number, number];
	out: string;
}

function flagsOf(argv: string[]): Map<string, string> {
	const flags = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (key?.startsWith('--') && value !== undefined) flags.set(key.slice(2), value);
	}
	return flags;
}

function parseArgs(argv: string[]): Args {
	const flags = flagsOf(argv);

	const id = flags.get('id');
	const label = flags.get('label');
	const bbox = flags.get('bbox');
	if (!id || !label || !bbox) {
		throw new Error('need --id, --label and --bbox west,south,east,north');
	}

	const parts = bbox.split(',').map(Number);
	if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
		throw new Error(`bad bbox: ${bbox}`);
	}

	return {
		id,
		label,
		bbox: parts as [number, number, number, number],
		// packs are published to the Hugging Face dataset repo, not bundled - the app downloads
		// them. the one committed pack is a test fixture, written explicitly with --out
		out: flags.get('out') ?? 'dist-areas'
	};
}

/** every key=value in the affordance table, as an Overpass filter over nodes, ways and relations */
function buildQuery(bbox: [number, number, number, number]): string {
	const [west, south, east, north] = bbox;
	const area = `${south},${west},${north},${east}`;

	const clauses = Object.keys(TAG_AFFORDANCES).map((tag) => {
		const [key, value] = tag.split('=');
		return ['node', 'way', 'relation']
			.map((kind) => `${kind}["${key}"="${value}"](${area});`)
			.join('');
	});

	// `center` gives ways and relations a single point without their full geometry
	return `[out:json][timeout:180];(${clauses.join('')});out center tags;`;
}

interface OverpassElement {
	type?: string;
	id?: number;
	lat?: number;
	lon?: number;
	center?: { lat?: number; lon?: number };
	tags?: Record<string, string>;
}

function toPlace(element: OverpassElement): PackedPlace | null {
	const tags = element.tags;
	if (!tags || !isPublic(tags)) return null;

	const affordances = affordancesForTags(tags);
	if (affordances.length === 0) return null;

	const lat = element.lat ?? element.center?.lat;
	const lon = element.lon ?? element.center?.lon;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

	// snapped at build time, so a pack can never carry finer resolution than the app will use
	const cell = snapToGrid(lat, lon);
	const name = tags.name?.trim();

	return {
		id: `${(element.type ?? 'n')[0]}${element.id ?? 0}`,
		lat: cell.latitude,
		lon: cell.longitude,
		a: affordances,
		// omitted rather than invented when OSM has no name
		...(name ? { n: name.slice(0, 60) } : {})
	};
}

/** identical cell plus identical affordance set is a duplicate, however OSM modelled it */
function dedupe(places: PackedPlace[]): PackedPlace[] {
	const seen = new Map<string, PackedPlace>();
	for (const place of places) {
		const key = `${place.lat},${place.lon},${place.a.join('')}`;
		const existing = seen.get(key);
		// keep the named one; a name is the only thing that distinguishes them to a reader
		if (!existing || (!existing.n && place.n)) seen.set(key, place);
	}
	return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Ask Overpass, with backoff.
 *
 * 429 is the documented rate-limit response and 504 means the instance could not satisfy the
 * request in time - both are transient and both were seen in practice on the very first run of
 * this script. A public community instance is allowed to say no; failing a publish on one 504
 * would just mean re-running the whole job.
 */
async function queryOverpass(id: string, query: string): Promise<{ elements?: OverpassElement[] }> {
	const attempts = 4;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		console.log(`querying overpass for ${id} (attempt ${attempt}/${attempts}) ...`);

		let response: Response | null = null;
		try {
			response = await fetch(OVERPASS, {
				method: 'POST',
				body: `data=${encodeURIComponent(query)}`,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'recess-area-pack-builder/1.0 (github.com/earth-app)'
				}
			});
		} catch (error) {
			if (attempt === attempts) throw error;
		}

		if (response?.ok) return (await response.json()) as { elements?: OverpassElement[] };

		const status = response ? `${response.status} ${response.statusText}` : 'network error';
		const retryable = !response || response.status === 429 || response.status >= 500;
		if (!retryable || attempt === attempts) throw new Error(`overpass ${status}`);

		// 30s, 60s, 120s - the public instances recover on the order of a minute, not seconds
		const wait = 30_000 * 2 ** (attempt - 1);
		console.log(`  ${status}; retrying in ${wait / 1000}s`);
		await new Promise((resolve) => setTimeout(resolve, wait));
	}

	throw new Error('overpass: exhausted retries');
}

async function buildArea(args: Args) {
	const query = buildQuery(args.bbox);

	const body = await queryOverpass(args.id, query);
	const elements = body.elements ?? [];

	const places = dedupe(
		elements.map(toPlace).filter((value): value is PackedPlace => value !== null)
	);

	const pack: AreaPack = {
		version: 1,
		id: args.id,
		label: args.label,
		bbox: args.bbox,
		built_at: Date.now(),
		attribution: ATTRIBUTION,
		places
	};

	const json = JSON.stringify(pack);
	const gzipped = gzipSync(Buffer.from(json), { level: 9 });

	await mkdir(args.out, { recursive: true });
	const path = `${args.out}/${args.id}.json`;
	await writeFile(path, json);

	// per-affordance counts, so a token that is not actually populated here is visible rather
	// than silently shipping as a filter that matches nothing
	const counts = new Map<string, number>();
	for (const place of places) {
		for (const affordance of place.a) counts.set(affordance, (counts.get(affordance) ?? 0) + 1);
	}

	console.log(`\n${args.id}: ${elements.length} elements -> ${places.length} places`);
	console.log(
		`raw ${(json.length / 1024).toFixed(1)} KB, gzipped ${(gzipped.length / 1024).toFixed(1)} KB`
	);
	console.log(`written to ${path}\n`);
	console.log('affordance coverage:');
	for (const [affordance, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${count.toString().padStart(6)}  ${affordance}`);
	}

	const missing = Object.values(TAG_AFFORDANCES)
		.flat()
		.filter((affordance, index, all) => all.indexOf(affordance) === index)
		.filter((affordance) => !counts.has(affordance));
	if (missing.length > 0) console.log(`\nnot present in this area: ${missing.join(', ')}`);
}

interface AreaSpec {
	id: string;
	label: string;
	bbox: [number, number, number, number];
}

/**
 * Pause between areas.
 *
 * The Overpass maintainers ask that automated use stay light on the public instances, and a live
 * `/api/status` reports only two concurrent slots per IP - which CI runners share. One query per
 * area with a real gap between them is the difference between a courteous consumer and the
 * "app relying on the public instances as a backend" their manual calls out.
 */
const AREA_DELAY_MS = 20_000;

async function main() {
	const flags = flagsOf(process.argv.slice(2));

	if (!flags.has('all')) {
		await buildArea(parseArgs(process.argv.slice(2)));
		return;
	}

	const listPath = flags.get('all') || 'scripts/areas.json';
	const { areas } = JSON.parse(await readFile(listPath, 'utf8')) as { areas: AreaSpec[] };
	if (!Array.isArray(areas) || areas.length === 0) throw new Error(`no areas in ${listPath}`);

	const out = flags.get('out') ?? 'dist-areas/packs';
	console.log(`building ${areas.length} area(s) from ${listPath}\n`);

	for (const [index, area] of areas.entries()) {
		await buildArea({ ...area, out });
		if (index < areas.length - 1) {
			console.log(`\nwaiting ${AREA_DELAY_MS / 1000}s before the next area ...\n`);
			await new Promise((resolve) => setTimeout(resolve, AREA_DELAY_MS));
		}
	}
}

await main();
