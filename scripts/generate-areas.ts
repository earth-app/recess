/**
 * Generate `scripts/areas.json` from real OpenStreetMap data.
 *
 * Coordinates are facts, so none of them are typed here. Two Overpass queries do the work: one
 * for every national capital OSM tags as such, one for the curated extras below resolved by name.
 * Re-run it when the extras list changes; the output is committed so CI never needs to.
 *
 * Usage:
 *   bun run scripts/generate-areas.ts [--out scripts/areas.json]
 *
 * On the political question: the capital list is whatever OSM tags `capital=yes`, not a list
 * anyone here curated. That is deliberate - it means Jerusalem, Ramallah, Taipei and every other
 * contested case are included or not by the same rule as Paris, and nobody is drawing a line.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Several instances, rotated per attempt.
 *
 * One endpoint answers 504 and 429 under load often enough that a 900-clause run spends most of
 * its wall clock in backoff. Rotating spreads the same total work over independent instances,
 * which is both faster and politer than hammering one. Order is the fallback order.
 */
const OVERPASS_ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

/** half-width of the box around a city centre, in km; a pack is a city centre, not a metro area */
const DEFAULT_RADIUS_KM = 2.5;

/**
 * Where the US and Canadian city names come from.
 *
 * `earth-app/moho` already curates these lists for the anniversary data, so reusing them keeps
 * recess's area coverage consistent with the rest of the org instead of inventing a second,
 * slightly different list of what counts as a city. Only the NAMES are taken - every coordinate
 * still comes from OSM.
 */
const MOHO_LISTS = ['us/cities.csv', 'ca/cities.csv'];

/** resolved through the installed package, so this does not depend on a sibling checkout */
function mohoDataDir(): string {
	const manifest = createRequire(import.meta.url).resolve('@earth-app/moho/package.json');
	return join(dirname(manifest), 'src/data/birthdays');
}

/**
 * Extras beyond the capitals and the moho lists: places people travel to, plus a few that are
 * simply good to walk around. `radius` widens the box where the interesting part is spread out.
 */
const EXTRAS: { name: string; radius?: number; country?: string; region?: string }[] = [
	// asked for by name; Chicago, Houston, Los Angeles and Ontario come from the moho US list
	{ name: 'Barcelona', country: 'ES' },
	{ name: 'Roma', country: 'IT' },
	{ name: 'Ciudad de México', country: 'MX' },

	// the rest of the usual suspects
	{ name: 'Montréal', country: 'CA' },
	{ name: 'Vancouver', country: 'CA' },
	{ name: 'Rio de Janeiro', country: 'BR' },
	{ name: 'São Paulo', country: 'BR' },
	{ name: 'Cartagena', country: 'CO' },
	{ name: 'Milano', country: 'IT' },
	{ name: 'Firenze', country: 'IT' },
	{ name: 'München', country: 'DE' },
	{ name: 'Hamburg', country: 'DE' },
	{ name: 'Sevilla', country: 'ES' },
	{ name: 'Valencia', country: 'ES' },
	{ name: 'Porto', country: 'PT' },
	{ name: 'Marseille', country: 'FR' },
	{ name: 'Lyon', country: 'FR' },
	{ name: 'Kraków', country: 'PL' },
	{ name: 'İstanbul', country: 'TR' },
	{ name: 'Kyoto', country: 'JP' },
	{ name: 'Osaka', country: 'JP' },
	{ name: 'Busan', country: 'KR' },
	{ name: 'Shanghai', country: 'CN' },
	{ name: 'Hong Kong', country: 'HK' },
	{ name: 'Chiang Mai', country: 'TH' },
	{ name: 'Đà Nẵng', country: 'VN' },
	{ name: 'Melbourne', country: 'AU' },
	{ name: 'Sydney', country: 'AU' },
	{ name: 'Auckland', country: 'NZ' },
	{ name: 'Marrakesh', country: 'MA' },
	{ name: 'Cape Town', country: 'ZA' },
	{ name: 'Zanzibar City', country: 'TZ' },

	/**
	 * The niche end. Each is here for a reason a nudge could use: somewhere small enough to walk
	 * end to end, or somewhere with an unusual density of things worth noticing.
	 */
	// the whole country is one walkable pack
	{ name: 'Vaduz', country: 'LI' },
	{ name: 'San Marino', country: 'SM' },
	// a canal city with almost no cars
	{ name: 'Giethoorn', country: 'NL' },
	// bookshops per capita is the entire point
	{ name: 'Hay-on-Wye', country: 'GB' },
	// painted every colour, on a hillside
	{ name: 'Guanajuato', country: 'MX' },
	// the observatory town; the sky is the attraction
	{ name: 'Greenwich', radius: 1.5, country: 'GB' },
	// a UNESCO mining town built into a canyon
	{ name: 'Røros', country: 'NO' },
	// the oldest continuously inhabited street grid people still shop on
	{ name: 'Toledo', country: 'ES' },
	// a city of stairs
	{ name: 'Valparaíso', country: 'CL' },
	// deliberately car-free
	{ name: 'Zermatt', country: 'CH' },
	{ name: 'Ghent', country: 'BE' },
	// built on 118 islands, so every walk crosses water
	{ name: 'Venice', radius: 2, country: 'IT' },
	// a whole town of second-hand books and one of the darkest skies in Europe
	{ name: 'Wigtown', country: 'GB' },
	// the midnight sun end of the scale
	{ name: 'Tromsø', country: 'NO' },
	// the other end
	{ name: 'Ushuaia', country: 'AR' },

	// #region more international hubs
	{ name: 'Praha', country: 'CZ' },
	{ name: 'Budapest', country: 'HU' },
	{ name: 'Wien', country: 'AT' },
	{ name: 'Amsterdam', country: 'NL' },
	{ name: 'København', country: 'DK' },
	{ name: 'Edinburgh', country: 'GB' },
	{ name: 'Dublin', country: 'IE' },
	{ name: 'Athina', country: 'GR' },
	{ name: 'Dubrovnik', country: 'HR' },
	{ name: 'Split', country: 'HR' },
	{ name: 'Ljubljana', country: 'SI' },
	{ name: 'Tallinn', country: 'EE' },
	{ name: 'Riga', country: 'LV' },
	{ name: 'Vilnius', country: 'LT' },
	{ name: 'Bruges', country: 'BE' },
	{ name: 'Antwerpen', country: 'BE' },
	{ name: 'Rotterdam', country: 'NL' },
	{ name: 'Utrecht', country: 'NL' },
	{ name: 'Bologna', country: 'IT' },
	{ name: 'Napoli', country: 'IT' },
	{ name: 'Palermo', country: 'IT' },
	{ name: 'Torino', country: 'IT' },
	{ name: 'Genova', country: 'IT' },
	{ name: 'Verona', country: 'IT' },
	{ name: 'Bilbao', country: 'ES' },
	{ name: 'Granada', country: 'ES' },
	{ name: 'Málaga', country: 'ES' },
	{ name: 'Lisboa', country: 'PT' },
	{ name: 'Bordeaux', country: 'FR' },
	{ name: 'Nice', country: 'FR' },
	{ name: 'Strasbourg', country: 'FR' },
	{ name: 'Toulouse', country: 'FR' },
	{ name: 'Köln', country: 'DE' },
	{ name: 'Dresden', country: 'DE' },
	{ name: 'Leipzig', country: 'DE' },
	{ name: 'Frankfurt am Main', country: 'DE' },
	{ name: 'Zürich', country: 'CH' },
	{ name: 'Genève', country: 'CH' },
	{ name: 'Salzburg', country: 'AT' },
	{ name: 'Innsbruck', country: 'AT' },
	{ name: 'Gdańsk', country: 'PL' },
	{ name: 'Wrocław', country: 'PL' },
	{ name: 'Bergen', country: 'NO' },
	{ name: 'Göteborg', country: 'SE' },
	{ name: 'Turku', country: 'FI' },
	{ name: 'Reykjavík', country: 'IS' },
	{ name: 'Porto Alegre', country: 'BR' },
	{ name: 'Medellín', country: 'CO' },
	{ name: 'Cusco', country: 'PE' },
	{ name: 'Arequipa', country: 'PE' },
	{ name: 'Valdivia', country: 'CL' },
	{ name: 'Córdoba', country: 'AR' },
	{ name: 'Montevideo', country: 'UY' },
	{ name: 'Oaxaca de Juárez', country: 'MX' },
	{ name: 'Mérida', country: 'MX' },
	{ name: 'Puebla', country: 'MX' },
	{ name: 'San Miguel de Allende', country: 'MX' },
	{ name: 'Antigua Guatemala', country: 'GT' },
	{ name: 'Fez', country: 'MA' },
	{ name: 'Essaouira', country: 'MA' },
	{ name: 'Stone Town', country: 'TZ' },
	{ name: 'Lamu', country: 'KE' },
	{ name: 'Luang Prabang', country: 'LA' },
	{ name: 'Hoi An', country: 'VN' },
	{ name: 'Kanazawa', country: 'JP' },
	{ name: 'Nara', country: 'JP' },
	{ name: 'Sapporo', country: 'JP' },
	{ name: 'Gyeongju', country: 'KR' },
	{ name: 'Jeonju', country: 'KR' },
	{ name: 'Tainan', country: 'TW' },
	{ name: 'Penang', country: 'MY' },
	{ name: 'George Town', country: 'MY' },
	{ name: 'Udaipur', country: 'IN' },
	{ name: 'Varanasi', country: 'IN' },
	{ name: 'Jaipur', country: 'IN' },
	{ name: 'Pokhara', country: 'NP' },
	{ name: 'Galle', country: 'LK' },
	{ name: 'Hobart', country: 'AU' },
	{ name: 'Wellington', country: 'NZ' },
	{ name: 'Queenstown', country: 'NZ' },
	{ name: 'Perth', country: 'AU' },
	// #endregion

	// #region the western united states, where the packs get thin
	// deliberately included: rural OSM carries far less locally-known affordance detail than
	// urban (Johnson et al., CHI 2016), so these are the real test of the thin-pack end state
	{ name: 'Moab', region: 'US-UT' },
	{ name: 'Bend', region: 'US-OR' },
	{ name: 'Taos', region: 'US-NM' },
	{ name: 'Sedona', region: 'US-AZ' },
	{ name: 'Flagstaff', region: 'US-AZ' },
	{ name: 'Bozeman', region: 'US-MT' },
	{ name: 'Missoula', region: 'US-MT' },
	{ name: 'Jackson', region: 'US-WY' },
	{ name: 'Durango', region: 'US-CO' },
	{ name: 'Telluride', region: 'US-CO' },
	{ name: 'Ouray', region: 'US-CO' },
	{ name: 'Bisbee', region: 'US-AZ' },
	{ name: 'Silver City', region: 'US-NM' },
	{ name: 'Truth or Consequences', region: 'US-NM' },
	{ name: 'Marfa', region: 'US-TX' },
	{ name: 'Terlingua', region: 'US-TX' },
	{ name: 'Alpine', region: 'US-TX' },
	{ name: 'Ely', region: 'US-NV' },
	{ name: 'Bishop', region: 'US-CA' },
	{ name: 'Lone Pine', region: 'US-CA' },
	{ name: 'Port Townsend', region: 'US-WA' },
	{ name: 'Astoria', region: 'US-OR' },
	{ name: 'Cannon Beach', region: 'US-OR' },
	{ name: 'Ashland', region: 'US-OR' },
	{ name: 'Sandpoint', region: 'US-ID' },
	{ name: 'Whitefish', region: 'US-MT' },
	{ name: 'Livingston', region: 'US-MT' },
	{ name: 'Cody', region: 'US-WY' },
	{ name: 'Lander', region: 'US-WY' },
	{ name: 'Salida', region: 'US-CO' },
	{ name: 'Crested Butte', region: 'US-CO' },
	{ name: 'Paonia', region: 'US-CO' },
	{ name: 'Kanab', region: 'US-UT' },
	{ name: 'Torrey', region: 'US-UT' },
	{ name: 'Springdale', region: 'US-UT' },
	// #endregion

	// #region fun, strange, or simply worth the walk
	// the UFO museum is the town's civic centre
	{ name: 'Roswell', region: 'US-NM' },
	// one street, and the reason anyone drives that highway
	{ name: 'Rachel', region: 'US-NV' },
	// opal mining town where most of the population lives underground
	{ name: 'Coober Pedy', country: 'AU' },
	// a lake town so photogenic it was copied wholesale in China
	{ name: 'Hallstatt', country: 'AT' },
	// the northernmost town with a functioning high street
	{ name: 'Longyearbyen', country: 'NO' },
	// painted houses stacked on a cliff over the Atlantic
	{ name: 'Nazaré', country: 'PT' },
	// a spa town built entirely around drinking the water
	{ name: 'Karlovy Vary', country: 'CZ' },
	// the whole place is a fortress you can walk the walls of
	{ name: 'Carcassonne', country: 'FR' },
	// tulip fields and a windmill count you can actually finish
	{ name: 'Kinderdijk', country: 'NL' },
	// a town of ceramic tiles, top to bottom
	{ name: 'Aveiro', country: 'PT' },
	// bookshop town number three; there is a small international circuit of these
	{ name: 'Redu', country: 'BE' },
	// clocks: the whole valley makes them
	{ name: 'La Chaux-de-Fonds', country: 'CH' },
	// a medieval town nobody modernised
	{ name: 'Rothenburg ob der Tauber', country: 'DE' },
	// built into a gorge with houses hanging off it
	{ name: 'Ronda', country: 'ES' },
	// cave dwellings still lived in
	{ name: 'Matera', country: 'IT' },
	// blue, entirely, on purpose
	{ name: 'Chefchaouen', country: 'MA' },
	// a salt cathedral under a working mine
	{ name: 'Wieliczka', country: 'PL' },
	// street art is the municipal policy
	{ name: 'Valletta', country: 'MT' },
	// the observatory island; almost no artificial light
	{ name: 'Santa Cruz de La Palma', country: 'ES' },
	// a town that exists because of one very large telescope
	{ name: 'Green Bank', region: 'US-WV' },
	// the quietest square mile in the lower 48 is next door
	{ name: 'Forks', region: 'US-WA' },
	// hot springs, and the town is the pool
	{ name: 'Hot Springs', region: 'US-AR' },
	// a boardwalk over a swamp
	{ name: 'Apalachicola', region: 'US-FL' },
	// where the Mississippi actually starts, small enough to step over
	{ name: 'Bemidji', region: 'US-MN' },
	// the town the Grand Canyon railway leaves from
	{ name: 'Williams', region: 'US-AZ' },
	// nine hundred people and the best dark sky in Europe
	{ name: 'Moffat', country: 'GB' },
	// a fishing village stacked vertically
	{ name: 'Manarola', country: 'IT' },
	{ name: 'Riomaggiore', country: 'IT' }
	// #endregion
];

/**
 * Landmarks - DECLARED BUT NOT WIRED IN.
 *
 * The city resolver now constrains every name to an OSM administrative area; this list has not
 * had that treatment. Resolving a landmark by name alone is exactly what put the Statue of
 * Liberty on the Paris replica, so it stays unwired until each entry carries a country the way
 * EXTRAS does. Leaving it declared keeps the curation; wiring it as-is would ship wrong
 * coordinates.
 *
 * Landmarks, resolved differently from cities.
 *
 * A landmark is usually a way or a relation (a building outline, a circuit, a park boundary), not
 * a `place` node, so these are matched on name across all three element types with `out center`.
 * The radius is small on purpose: the pack should cover the thing and its approach, not the city
 * it happens to sit in - that city is almost always already in the list above.
 */
const LANDMARKS: { name: string; radius?: number }[] = [
	// asked for by name
	{ name: 'Statue of Liberty' },
	{ name: 'Circuit of the Americas', radius: 3 },
	{ name: 'Circuit de Monaco', radius: 2 },

	// motorsport, where the circuit *is* the walk
	{ name: 'Silverstone Circuit', radius: 3 },
	{ name: 'Circuit de Spa-Francorchamps', radius: 4 },
	{ name: 'Autodromo Nazionale di Monza', radius: 3 },
	{ name: 'Indianapolis Motor Speedway', radius: 3 },
	{ name: 'Nürburgring', radius: 5 },
	{ name: 'Circuit de Barcelona-Catalunya', radius: 3 },
	{ name: 'Suzuka International Racing Course', radius: 3 },

	// the ones everyone photographs
	{ name: 'Tour Eiffel' },
	{ name: 'Colosseo' },
	{ name: 'Sagrada Família' },
	{ name: 'Big Ben' },
	{ name: 'Tower Bridge' },
	{ name: 'Brandenburger Tor' },
	{ name: 'Atomium' },
	{ name: 'Cristo Redentor' },
	{ name: 'Machu Picchu', radius: 3 },
	{ name: 'Chichén Itzá', radius: 3 },
	{ name: 'Taj Mahal' },
	{ name: 'Angkor Wat', radius: 4 },
	{ name: 'Borobudur', radius: 2 },
	{ name: 'Petra', radius: 4 },
	{ name: 'Giza Necropolis', radius: 4 },
	{ name: 'Acropolis of Athens' },
	{ name: 'Stonehenge', radius: 2 },
	{ name: 'Alhambra' },
	{ name: 'Mont Saint-Michel' },
	{ name: 'Neuschwanstein Castle' },
	{ name: 'Charles Bridge' },
	{ name: 'Golden Gate Bridge', radius: 3 },
	{ name: 'Gateway Arch' },
	{ name: 'Space Needle' },
	{ name: 'Hollywood Sign', radius: 2 },
	{ name: 'Niagara Falls', radius: 3 },
	{ name: 'CN Tower' },
	{ name: 'Sydney Opera House' },
	{ name: 'Table Mountain', radius: 4 },
	{ name: 'Victoria Falls', radius: 4 },
	{ name: 'Uluru', radius: 5 },
	{ name: 'Mount Fuji', radius: 5 },
	{ name: 'Great Wall of China', radius: 4 },
	{ name: 'Forbidden City' },
	{ name: 'Marina Bay Sands' },
	{ name: 'Burj Khalifa' },
	{ name: 'Hagia Sophia' },
	{ name: 'Kremlin' },
	{ name: 'Times Square', radius: 1.5 },
	{ name: 'Central Park', radius: 3 },
	{ name: 'Golden Gate Park', radius: 3 },
	{ name: 'Hyde Park', radius: 2.5 },
	{ name: 'Tiergarten', radius: 3 },
	{ name: 'Bois de Boulogne', radius: 4 },
	{ name: 'Vondelpark', radius: 2 },
	{ name: 'Ueno Park', radius: 2 },
	{ name: 'Parc Güell', radius: 1.5 },
	{ name: 'Christiansborg Slot' },
	{ name: 'Rijksmuseum' },
	{ name: 'Musée du Louvre' },
	{ name: 'Guggenheim Bilbao' },
	{ name: 'Panama Canal', radius: 5 },
	{ name: 'Iguazú Falls', radius: 4 },
	{ name: 'Salar de Uyuni', radius: 5 },
	{ name: 'Blue Lagoon', radius: 2 },
	{ name: 'Geysir', radius: 2 },
	{ name: 'Pamukkale', radius: 3 },
	{ name: 'Cappadocia', radius: 5 },
	{ name: 'Meteora', radius: 4 },
	{ name: 'Plitvice Lakes National Park', radius: 5 },
	{ name: 'Cliffs of Moher', radius: 3 },
	{ name: "Giant's Causeway", radius: 2 },
	{ name: 'Loch Ness', radius: 5 },
	{ name: 'Trolltunga', radius: 3 },
	{ name: 'Preikestolen', radius: 3 }
];

interface OverpassNode {
	id?: number;
	lat?: number;
	lon?: number;
	/** ways and relations carry their centroid here rather than as lat/lon */
	center?: { lat?: number; lon?: number };
	tags?: Record<string, string>;
}

async function ask(query: string, label: string): Promise<OverpassNode[]> {
	for (let attempt = 1; attempt <= 6; attempt++) {
		console.log(`querying overpass for ${label} (attempt ${attempt}/6) ...`);
		const endpoint = OVERPASS_ENDPOINTS[(attempt - 1) % OVERPASS_ENDPOINTS.length]!;
		let response: Response | null = null;
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				body: `data=${encodeURIComponent(query)}`,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'recess-area-list-builder/1.0 (github.com/earth-app)'
				}
			});
		} catch (error) {
			if (attempt === 6) throw error;
		}

		if (response?.ok) {
			const body = (await response.json()) as { elements?: OverpassNode[] };
			return body.elements ?? [];
		}

		const status = response ? `${response.status} ${response.statusText}` : 'network error';
		if (attempt === 6) throw new Error(`overpass ${status}`);
		// the next attempt hits a different instance, so the wait can be short
		const wait = Math.min(30_000, 4_000 * attempt);
		console.log(`  ${status}; retrying in ${wait / 1000}s`);
		await new Promise((resolve) => setTimeout(resolve, wait));
	}
	throw new Error('overpass: exhausted retries');
}

/** a slug that stays stable across runs and is safe as a filename */
function slugify(name: string, country: string | undefined): string {
	const clean = (value: string) =>
		value
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');

	const city = clean(name);
	return country ? `${country.toLowerCase()}-${city}` : city;
}

function boxAround(lat: number, lon: number, radiusKm: number): [number, number, number, number] {
	const dLat = radiusKm / 111.32;
	// longitude degrees shrink with latitude; floored so a polar city cannot produce a huge box
	const dLon = radiusKm / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
	const round = (value: number) => Number(value.toFixed(4));
	return [round(lon - dLon), round(lat - dLat), round(lon + dLon), round(lat + dLat)];
}

interface Area {
	id: string;
	label: string;
	bbox: [number, number, number, number];
}

function toArea(node: OverpassNode, radiusKm: number): Area | null {
	const tags = node.tags ?? {};
	const name = tags['name:en'] ?? tags.name;
	const lat = node.lat ?? node.center?.lat;
	const lon = node.lon ?? node.center?.lon;
	if (!name || typeof lat !== 'number' || typeof lon !== 'number') return null;

	return {
		id: slugify(name, tags['ISO3166-1'] ?? tags['is_in:country_code'] ?? undefined),
		label: name,
		bbox: boxAround(lat, lon, radiusKm)
	};
}

/**
 * City names out of a moho birthdays CSV.
 *
 * Lines look like `Albuquerque's Birthday,01/01,1891`, with `Los Angeles' Birthday` for names
 * already ending in s and `Arlington (TX)'s Birthday` where the name alone is ambiguous. The
 * parenthetical is kept as a disambiguation hint rather than thrown away.
 */
function namesFromMoho(csv: string): { name: string; hint?: string }[] {
	const found: { name: string; hint?: string }[] = [];

	for (const line of csv.split('\n')) {
		const cell = line.split(',')[0]?.trim();
		if (!cell) continue;

		const bare = cell
			.replace(/'s Birthday$/, '')
			.replace(/' Birthday$/, '')
			.trim();
		if (!bare || bare === cell) continue;

		const parenthetical = bare.match(/^(.*?)\s*\(([^)]+)\)$/);
		if (parenthetical)
			found.push({ name: parenthetical[1]!.trim(), hint: parenthetical[2]!.trim() });
		else found.push({ name: bare });
	}

	return found;
}

async function main() {
	const outIndex = process.argv.indexOf('--out');
	const out = outIndex >= 0 ? (process.argv[outIndex + 1] ?? '') : 'scripts/areas.json';
	const mohoIndex = process.argv.indexOf('--moho');
	const mohoDir = mohoIndex >= 0 ? (process.argv[mohoIndex + 1] ?? '') : mohoDataDir();

	const fromMoho: { name: string; hint?: string; country: string }[] = [];
	for (const list of MOHO_LISTS) {
		try {
			// the directory IS the country, so every moho name arrives already scoped
			const country = list.split('/')[0]!.toUpperCase();
			const parsed = namesFromMoho(await readFile(join(mohoDir, list), 'utf8'));
			fromMoho.push(...parsed.map((entry) => ({ ...entry, country })));
			console.log(`  ${parsed.length} names from ${list}`);
		} catch {
			console.log(`  could not read ${join(mohoDir, list)} - skipping`);
		}
	}

	// every place node OSM marks as a national capital
	// exact tag matches, never a regex: `["place"~"^(city|town)$"]` made this a global scan and
	// the public instance answered 504 three times running, where the union below returns in ~12s
	const capitals = await ask(
		'[out:json][timeout:180];(node["capital"="yes"]["place"="city"];node["capital"="yes"]["place"="town"];);out tags center;',
		'national capitals'
	);
	console.log(`  ${capitals.length} capitals\n`);

	const areas = new Map<string, Area>();
	const skipped: string[] = [];

	for (const node of capitals) {
		const area = toArea(node, DEFAULT_RADIUS_KM);
		if (area) areas.set(area.id, area);
	}

	/**
	 * Every name to resolve, tagged with where on earth it is.
	 *
	 * The scope is the whole point. Matching on name alone and picking the most populous hit put
	 * "Cambridge (MA)" in England, "Salem (OR)" in India and Fes in Maharashtra - population is
	 * not a tiebreak when the bigger namesake is on another continent, and the "(MA)" hint did
	 * nothing because OSM place nodes do not carry a bare state code anywhere in their tags.
	 * Constraining the query to an administrative area makes the country a hard filter instead.
	 */
	interface Request {
		name: string;
		radius?: number;
		/** ISO 3166-1, e.g. `US` */
		country?: string;
		/** ISO 3166-2, e.g. `US-MT`; wins over country when both are set */
		region?: string;
	}

	const requests: Request[] = [
		...EXTRAS,
		// moho's lists are US and Canadian by construction, so the country is known for free
		...fromMoho.map((entry) => ({
			name: entry.name,
			country: entry.country,
			region: entry.hint && entry.country === 'US' ? `US-${entry.hint}` : undefined
		}))
	];

	const byScope = new Map<string, Map<string, Request>>();
	for (const request of requests) {
		const scope = request.region ?? request.country ?? '*';
		const bucket = byScope.get(scope) ?? new Map<string, Request>();
		if (!bucket.has(request.name)) bucket.set(request.name, request);
		byScope.set(scope, bucket);
	}

	const CHUNK = 40;
	const WANTED_PLACES = new Set(['city', 'town', 'suburb', 'village', 'borough']);

	/**
	 * Small scopes travel together.
	 *
	 * Most country scopes hold one to three names, and issuing ~50 separate requests for them was
	 * slow and a lot of load for a public instance to absorb. Overpass lets each scope bind its
	 * own set, so a batch resolves in one round trip while every name stays constrained to its
	 * own country. Safe to share a response: a name only appears in the batch under the one scope
	 * that asked for it, and the per-request name match below does the separating.
	 */
	const BATCH = 12;
	const small = [...byScope.entries()].filter(([scope, b]) => scope !== '*' && b.size <= 6);
	const shared = new Map<string, OverpassNode[]>();

	for (let offset = 0; offset < small.length; offset += BATCH) {
		const slice = small.slice(offset, offset + BATCH);
		const declarations = slice
			.map(([scope], index) =>
				scope.includes('-')
					? `area["ISO3166-2"="${scope}"]->.s${index};`
					: `area["ISO3166-1"="${scope}"][admin_level=2]->.s${index};`
			)
			.join('');
		const body = slice
			.flatMap(([, bucket], index) =>
				[...bucket.keys()].map((name) => {
					const escaped = name.replace(/"/g, '\\"');
					return `node(area.s${index})["name"="${escaped}"]["place"];node(area.s${index})["name:en"="${escaped}"]["place"];`;
				})
			)
			.join('');

		const nodes = await ask(
			`[out:json][timeout:180];${declarations}(${body});out tags center;`,
			`${slice.length} scopes (${slice.map(([scope]) => scope).join(' ')})`
		);
		for (const [scope] of slice) shared.set(scope, nodes);
		if (offset + BATCH < small.length) await new Promise((r) => setTimeout(r, 1500));
	}

	for (const [scope, bucket] of byScope) {
		// `name` and `name:en` both, because OSM stores Kyoto as `name=京都市`
		const clauseFor = (name: string) => {
			const escaped = name.replace(/"/g, '\\"');
			return scope === '*'
				? `node["name"="${escaped}"]["place"];node["name:en"="${escaped}"]["place"];`
				: `node(area.s)["name"="${escaped}"]["place"];node(area.s)["name:en"="${escaped}"]["place"];`;
		};
		const areaClause =
			scope === '*'
				? ''
				: scope.includes('-')
					? `area["ISO3166-2"="${scope}"]->.s;`
					: `area["ISO3166-1"="${scope}"][admin_level=2]->.s;`;

		const names = [...bucket.keys()];
		const found: OverpassNode[] = shared.get(scope) ?? [];

		// already answered as part of a shared batch above
		for (let start = 0; found.length === 0 && start < names.length; start += CHUNK) {
			const slice = names.slice(start, start + CHUNK);
			found.push(
				...(await ask(
					`[out:json][timeout:180];${areaClause}(${slice.map(clauseFor).join('')});out tags center;`,
					`${scope} ${start + 1}-${start + slice.length} of ${names.length}`
				))
			);
			if (start + CHUNK < names.length) await new Promise((r) => setTimeout(r, 1500));
		}

		for (const request of bucket.values()) {
			const matches = found.filter(
				(node) =>
					(node.tags?.name === request.name || node.tags?.['name:en'] === request.name) &&
					WANTED_PLACES.has(node.tags?.place ?? '')
			);
			if (matches.length === 0) {
				skipped.push(scope === '*' ? request.name : `${request.name} [${scope}]`);
				continue;
			}

			// inside a single country or state, population IS a sound tiebreak
			const size = (node: OverpassNode) => Number(node.tags?.population ?? 0);
			const best = matches.reduce((winner, node) => (size(node) > size(winner) ? node : winner));

			const area = toArea(best, request.radius ?? DEFAULT_RADIUS_KM);
			if (!area) continue;
			// keep the region in the id so two Arlingtons stay distinguishable
			const suffix = request.region ? `-${request.region.split('-')[1]!.toLowerCase()}` : '';
			const labelled = suffix
				? {
						...area,
						id: `${area.id}${suffix}`,
						label: `${area.label} (${request.region!.split('-')[1]})`
					}
				: area;
			if (!areas.has(labelled.id)) areas.set(labelled.id, labelled);
		}
	}

	// a name that does not match must be visible, or it vanishes and nobody knows the area is
	// missing. each one is a spelling to correct in EXTRAS, not a data problem
	if (skipped.length > 0) {
		console.log(`\n  ${skipped.length} name(s) had no OSM match and were skipped:`);
		console.log(`    ${skipped.join(', ')}`);
	}

	const sorted = [...areas.values()].sort((a, b) => (a.id < b.id ? -1 : 1));

	await writeFile(
		out,
		`${JSON.stringify(
			{
				comment:
					'GENERATED by scripts/generate-areas.ts from OpenStreetMap - do not hand-edit coordinates. Capitals are whatever OSM tags capital=yes; extras are curated by name in the script and resolved to the most populous match. bbox is [west, south, east, north], a fixed box around the city centre rather than an administrative boundary.',
				generated_at: new Date().toISOString().slice(0, 10),
				areas: sorted
			},
			null,
			'\t'
		)}\n`
	);

	console.log(`\nwrote ${sorted.length} areas to ${out}`);
}

await main();
