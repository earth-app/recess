/**
 * Build `manifest.json` and the dataset README from a directory of packs.
 *
 * Derived, never typed. The manifest's `bytes` is shown to the user on the download button, and
 * `places` is what the app checks before offering an area - both are facts about a file that
 * already exists, so reading them off disk is the only way they cannot be wrong. The README is
 * emitted here for the same reason: the ODbL attribution has to name the real source and filter,
 * and a hand-maintained copy would drift from the script that actually cut the data.
 *
 * Usage:
 *   bun run scripts/build-area-manifest.ts [--dir dist-areas]
 *
 * Then upload the whole directory to the Hugging Face dataset repo; see the README it writes.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { areaManifestSchema, areaPackSchema, type AreaManifestEntry } from '../src/types/places';

const AREA_REPO = 'earth-app/recess-areas';

function parseArgs(argv: string[]): { dir: string } {
	const index = argv.indexOf('--dir');
	return { dir: index >= 0 ? (argv[index + 1] ?? 'dist-areas') : 'dist-areas' };
}

function readme(entries: readonly AreaManifestEntry[]): string {
	const rows = entries
		.map(
			(entry) =>
				`| \`${entry.id}\` | ${entry.label} | ${entry.places.toLocaleString()} | ${(entry.bytes / 1024).toFixed(0)} KB |`
		)
		.join('\n');

	return `---
license: odbl
tags:
  - openstreetmap
  - geospatial
  - points-of-interest
---

# Recess area packs

Small offline extracts of OpenStreetMap, used by [Recess](https://github.com/earth-app/recess) to
answer one question on-device: **what is around you that you could actually do something at.**

Each pack is a filtered, reduced derivative of OSM. It is not a map and it is not a business
directory - every record is a place reduced to an id, a coordinate and a set of *affordances*
(somewhere to sit, somewhere quiet, water, a long view, shelter, and so on).

## Contents

| Pack | Area | Places | Size |
| --- | --- | --- | --- |
${rows}

- \`manifest.json\` - the catalogue the app reads first, listing every pack with its bounding box
  and its real measured size.
- \`packs/<id>.json\` - one pack per area.

## Record shape

\`\`\`jsonc
{
  "id": "n123456789",   // OSM element type + id
  "lat": 41.8819,       // snapped to a fixed 100 m grid
  "lon": -87.6278,
  "a": ["sit", "green"], // affordances
  "n": "Grant Park"     // OSM name, omitted when there is none
}
\`\`\`

Coordinates are **snapped to a fixed 100 m grid at build time**, so a pack cannot carry finer
resolution than the app is willing to use. Nothing else from OSM is retained.

## How these were built

\`\`\`bash
bun run scripts/build-area-pack.ts --id <id> --label "<Label>" --bbox W,S,E,N
bun run scripts/build-area-manifest.ts
\`\`\`

Places are selected by a fixed tag allowlist (\`TAG_AFFORDANCES\` in the Recess source), which maps
OSM \`key=value\` pairs to affordances. Anything tagged \`access=private|no|permit|customers\` is
dropped, as is anything the allowlist does not name.

## Licence and attribution

Map data from **OpenStreetMap**, (c) OpenStreetMap contributors, available under the
**[Open Database License](https://opendatacommons.org/licenses/odbl/)** (ODbL).
See <https://www.openstreetmap.org/copyright>.

These packs are a **Derivative Database** under the ODbL: a bounding-box and tag filter over OSM,
with coordinates rounded to a grid. They are published here under the ODbL so the derivative
remains available, per section 4.6. Any further redistribution must keep this licence and this
attribution.

Recess displays "Map data from OpenStreetMap" on the surface that reads these packs.

## Not affiliated with the OpenStreetMap Foundation

This is a third-party extract. Errors in it are ours or are inherited from the source data; report
data problems upstream at [openstreetmap.org](https://www.openstreetmap.org/) and packaging
problems at [earth-app/recess](https://github.com/earth-app/recess/issues).
`;
}

async function main() {
	const { dir } = parseArgs(process.argv.slice(2));

	let files: string[];
	try {
		files = (await readdir(join(dir, 'packs'))).filter((name) => name.endsWith('.json'));
	} catch {
		throw new Error(
			`no packs found in ${dir}/packs - run build-area-pack.ts with --out ${dir}/packs`
		);
	}

	if (files.length === 0) throw new Error(`no packs found in ${dir}/packs`);

	const entries: AreaManifestEntry[] = [];
	for (const name of files.sort()) {
		const path = join(dir, 'packs', name);
		const body = await readFile(path, 'utf8');
		const pack = areaPackSchema.parse(JSON.parse(body));

		entries.push({
			id: pack.id,
			label: pack.label,
			bbox: pack.bbox,
			// measured off the file that will actually be served, never estimated
			bytes: Buffer.byteLength(body),
			places: pack.places.length,
			built_at: pack.built_at
		});

		const gz = gzipSync(Buffer.from(body), { level: 9 }).length;
		console.log(
			`${pack.id.padEnd(24)} ${pack.places.length.toString().padStart(6)} places  ` +
				`${(Buffer.byteLength(body) / 1024).toFixed(0).padStart(5)} KB  (${(gz / 1024).toFixed(0)} KB gzipped)`
		);
	}

	const manifest = areaManifestSchema.parse({ version: 1, areas: entries });
	await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, '\t'));
	await writeFile(join(dir, 'README.md'), readme(entries));

	console.log(`\nwrote ${dir}/manifest.json and ${dir}/README.md for ${entries.length} pack(s)`);
	console.log(`upload the contents of ${dir}/ to https://huggingface.co/datasets/${AREA_REPO}`);
}

await main();
