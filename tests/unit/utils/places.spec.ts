import type { AreaPack, PackedPlace } from '~/types/places';
import { AFFORDANCES } from '~/types/places';
import {
	affordancesForTags,
	bindPlaces,
	cellKey,
	hasAffordances,
	isPackUsable,
	isPublic,
	MIN_AFFORDANCE_COVERAGE,
	nearbyPlaces,
	packAffordances,
	reachabilityFor,
	visitedCells
} from '~/utils/places';

const ORIGIN = { latitude: 41.8819, longitude: -87.6278 };

/** ~0.0009 degrees of latitude is ~100 m, so `north(n)` is roughly n hundred metres away */
function north(hundredMetres: number): { lat: number; lon: number } {
	return { lat: ORIGIN.latitude + hundredMetres * 0.0009, lon: ORIGIN.longitude };
}

function place(id: string, a: PackedPlace['a'], at = north(1), name?: string): PackedPlace {
	return { id, lat: at.lat, lon: at.lon, a, ...(name ? { n: name } : {}) };
}

function pack(places: PackedPlace[]): AreaPack {
	return {
		version: 1,
		id: 'test-area',
		label: 'Test Area',
		bbox: [-88, 41, -87, 42],
		built_at: 1_700_000_000_000,
		attribution: 'OpenStreetMap contributors, ODbL',
		places
	};
}

describe('affordancesForTags', () => {
	it('maps a single tag', () => {
		expect(affordancesForTags({ amenity: 'bench' })).toEqual(['sit']);
	});

	it('returns every affordance a tag implies', () => {
		expect(affordancesForTags({ amenity: 'library' })).toEqual(
			expect.arrayContaining(['quiet', 'read', 'shelter'])
		);
	});

	it('unions across several tags without duplicating', () => {
		const found = affordancesForTags({ leisure: 'park', amenity: 'bench' });
		expect(found.filter((a) => a === 'sit')).toHaveLength(1);
		expect(found).toEqual(expect.arrayContaining(['sit', 'green', 'people']));
	});

	it('returns tokens in vocabulary order, so output is stable', () => {
		const found = affordancesForTags({ amenity: 'library', leisure: 'park' });
		const positions = found.map((a) => AFFORDANCES.indexOf(a));
		expect(positions).toEqual([...positions].sort((x, y) => x - y));
	});

	it('reads affordances carried as side tags on something else', () => {
		expect(affordancesForTags({ highway: 'bus_stop', bench: 'yes' })).toContain('sit');
		expect(affordancesForTags({ highway: 'bus_stop', covered: 'yes' })).toContain('shelter');
		expect(affordancesForTags({ leisure: 'park', drinking_water: 'yes' })).toContain('drink');
	});

	it('returns nothing for tags that carry no affordance', () => {
		expect(affordancesForTags({ building: 'yes', 'addr:city': 'Chicago' })).toEqual([]);
	});

	// the two tags that measurement retired; if either ever reappears it is a mistake
	it('does not resurrect the dead noticeboard tags', () => {
		expect(affordancesForTags({ amenity: 'noticeboard' })).toEqual([]);
		expect(affordancesForTags({ man_made: 'board' })).toEqual([]);
	});

	it('ignores a tree, which is not a destination', () => {
		expect(affordancesForTags({ natural: 'tree' })).toEqual([]);
	});
});

describe('isPublic', () => {
	it('treats an unmarked place as public', () => {
		expect(isPublic({ leisure: 'park' })).toBe(true);
	});

	it.each(['private', 'no', 'permit', 'customers'])('rejects access=%s', (access) => {
		expect(isPublic({ leisure: 'park', access })).toBe(false);
	});

	it.each(['yes', 'public', 'permissive'])('accepts access=%s', (access) => {
		expect(isPublic({ leisure: 'park', access })).toBe(true);
	});
});

describe('hasAffordances', () => {
	const bench = place('a', ['sit', 'green']);

	it('passes when nothing is required', () => {
		expect(hasAffordances(bench, undefined)).toBe(true);
		expect(hasAffordances(bench, [])).toBe(true);
	});

	// AND, matching the `permission` and `model_pack` filters rather than the enum ones
	it('requires every listed affordance, not any of them', () => {
		expect(hasAffordances(bench, ['sit'])).toBe(true);
		expect(hasAffordances(bench, ['sit', 'green'])).toBe(true);
		expect(hasAffordances(bench, ['sit', 'water'])).toBe(false);
	});
});

describe('nearbyPlaces', () => {
	const sample = pack([
		place('far', ['sit'], north(15)),
		place('near', ['sit'], north(1)),
		place('mid', ['green'], north(5))
	]);

	it('returns nothing without a pack or an origin', () => {
		expect(nearbyPlaces(null, ORIGIN)).toEqual([]);
		expect(nearbyPlaces(sample, null)).toEqual([]);
	});

	it('sorts nearest first', () => {
		expect(nearbyPlaces(sample, ORIGIN).map((n) => n.place.id)).toEqual(['near', 'mid', 'far']);
	});

	it('reports distance, bearing, compass and walking minutes', () => {
		const [first] = nearbyPlaces(sample, ORIGIN);
		expect(first!.metres).toBeGreaterThan(50);
		expect(first!.metres).toBeLessThan(150);
		expect(first!.compass).toBe('n');
		expect(first!.minutes).toBeGreaterThan(0);
	});

	it('applies the hard distance cut-off', () => {
		const ids = nearbyPlaces(sample, ORIGIN, { within: 700 }).map((n) => n.place.id);
		expect(ids).toEqual(['near', 'mid']);
	});

	it('filters by required affordances', () => {
		const ids = nearbyPlaces(sample, ORIGIN, { affordances: ['green'] }).map((n) => n.place.id);
		expect(ids).toEqual(['mid']);
	});

	it('honours a limit', () => {
		expect(nearbyPlaces(sample, ORIGIN, { limit: 2 })).toHaveLength(2);
	});

	it('breaks distance ties by id, so the order never shuffles between renders', () => {
		const tied = pack([place('b', ['sit'], north(1)), place('a', ['sit'], north(1))]);
		expect(nearbyPlaces(tied, ORIGIN).map((n) => n.place.id)).toEqual(['a', 'b']);
	});

	it('returns an empty list rather than throwing on an empty pack', () => {
		expect(nearbyPlaces(pack([]), ORIGIN)).toEqual([]);
	});
});

describe('reachabilityFor', () => {
	const sample = pack([place('near', ['sit'], north(1)), place('far', ['sit'], north(20))]);

	/**
	 * The fail-open contract. `null` means "could not be answered", and every caller has to treat
	 * that as unknown rather than as zero - it is what stops a user with no pack, no position, or
	 * a nudge with no affordances from having their deck quietly changed.
	 */
	it('is null when the question cannot be answered', () => {
		expect(reachabilityFor(null, ORIGIN, ['sit'])).toBeNull();
		expect(reachabilityFor(sample, null, ['sit'])).toBeNull();
		expect(reachabilityFor(sample, ORIGIN, undefined)).toBeNull();
		expect(reachabilityFor(sample, ORIGIN, [])).toBeNull();
	});

	it('is a definite zero when the pack simply holds nothing that fits', () => {
		expect(reachabilityFor(sample, ORIGIN, ['water'])).toBe(0);
	});

	it('scores the closest match, not the first one found', () => {
		// 'far' is listed first in the pack, so a first-match implementation would score ~exp(-5)
		const score = reachabilityFor(sample, ORIGIN, ['sit']);
		const farOnly = reachabilityFor(pack([place('far', ['sit'], north(20))]), ORIGIN, ['sit']);

		expect(score).toBeGreaterThan(farOnly! * 5);
		// ~100 m against the 1600 m default is exp(-0.25)
		expect(score).toBeCloseTo(Math.exp(-0.25), 1);
	});

	it('falls as the only match gets further away', () => {
		const close = reachabilityFor(pack([place('x', ['sit'], north(1))]), ORIGIN, ['sit']);
		const distant = reachabilityFor(pack([place('x', ['sit'], north(15))]), ORIGIN, ['sit']);
		expect(distant!).toBeLessThan(close!);
	});

	it('widens with a larger max', () => {
		const tight = reachabilityFor(sample, ORIGIN, ['sit'], 400);
		const loose = reachabilityFor(sample, ORIGIN, ['sit'], 4000);
		expect(loose!).toBeGreaterThan(tight!);
	});
});

describe('pack coverage', () => {
	it('lists distinct affordances in vocabulary order', () => {
		const sample = pack([place('a', ['green', 'sit']), place('b', ['sit', 'water'])]);
		expect(packAffordances(sample)).toEqual(['sit', 'green', 'water']);
	});

	it('is empty for no pack', () => {
		expect(packAffordances(null)).toEqual([]);
	});

	/**
	 * Coverage, not count. Johnson et al. (CHI 2016) found rural OSM carries more features per
	 * capita than urban while local editors supply 4% of rural tokens against 37.6% urban - so a
	 * POI count looks healthy precisely where the useful detail is missing.
	 */
	it('judges a pack on affordance breadth rather than on how many places it holds', () => {
		const manyPlacesOneAffordance = pack(
			Array.from({ length: 500 }, (_, index) => place(`p${index}`, ['sit'], north(index % 10)))
		);
		expect(manyPlacesOneAffordance.places.length).toBeGreaterThan(100);
		expect(isPackUsable(manyPlacesOneAffordance)).toBe(false);

		const fewPlacesBroadAffordances = pack([
			place('a', ['sit']),
			place('b', ['green']),
			place('c', ['water']),
			place('d', ['quiet'])
		]);
		expect(fewPlacesBroadAffordances.places).toHaveLength(MIN_AFFORDANCE_COVERAGE);
		expect(isPackUsable(fewPlacesBroadAffordances)).toBe(true);
	});

	it('treats a missing pack as unusable', () => {
		expect(isPackUsable(null)).toBe(false);
	});
});

describe('cellKey and visitedCells', () => {
	it('gives two positions in the same cell the same key', () => {
		expect(cellKey(41.8819, -87.6278)).toBe(cellKey(41.88192, -87.62783));
	});

	it('gives genuinely different places different keys', () => {
		expect(cellKey(41.8819, -87.6278)).not.toBe(cellKey(41.8919, -87.6278));
	});

	it('collects only entries that actually carry a place', () => {
		const cells = visitedCells([
			{ place: { lat: 41.8819, lon: -87.6278 } },
			{},
			{ place: { lat: 41.8919, lon: -87.6278 } }
		]);
		expect(cells.size).toBe(2);
	});

	// there is no passive tracking, so an untagged entry means "resolved somewhere unknown"
	it('is empty for a ledger with no place-bound resolutions', () => {
		expect(visitedCells([{}, {}, {}]).size).toBe(0);
	});
});

describe('bindPlaces', () => {
	const sample = pack([
		place('bench-near', ['sit'], north(2)),
		place('bench-far', ['sit'], north(8)),
		place('park', ['green', 'sit'], north(4))
	]);

	const sitNudge = { id: 'a.task.sit', place_affordances: ['sit'] as const };
	const greenNudge = { id: 'b.task.green', place_affordances: ['green'] as const };

	it('binds nothing without a pack or a position', () => {
		expect(bindPlaces([sitNudge], null, ORIGIN)).toEqual([]);
		expect(bindPlaces([sitNudge], sample, null)).toEqual([]);
	});

	it('skips a nudge that needs no place at all', () => {
		expect(bindPlaces([{ id: 'c.think.anywhere' }], sample, ORIGIN)).toEqual([]);
	});

	it('binds to the nearest place that fits', () => {
		const [binding] = bindPlaces([sitNudge], sample, ORIGIN);
		expect(binding?.place.place.id).toBe('bench-near');
	});

	it('respects the affordance requirement rather than just taking the nearest thing', () => {
		const [binding] = bindPlaces([greenNudge], sample, ORIGIN);
		expect(binding?.place.place.id).toBe('park');
	});

	// two nudges pointing at the same bench would make the day read as one errand
	it('never binds two nudges to the same place', () => {
		const bindings = bindPlaces(
			[sitNudge, { id: 'd.task.sit2', place_affordances: ['sit'] }],
			sample,
			ORIGIN
		);
		expect(bindings).toHaveLength(2);
		expect(bindings[0]?.place.place.id).not.toBe(bindings[1]?.place.place.id);
	});

	it('marks a place fresh when nothing has been resolved in its cell', () => {
		const [binding] = bindPlaces([sitNudge], sample, ORIGIN);
		expect(binding?.fresh).toBe(true);
	});

	it('prefers an unresolved cell over an equally close resolved one', () => {
		const visited = new Set([cellKey(north(2).lat, north(2).lon)]);
		const [binding] = bindPlaces([sitNudge], sample, ORIGIN, { visited });

		expect(binding?.place.place.id).toBe('park');
		expect(binding?.fresh).toBe(true);
	});

	/**
	 * Novelty must not send someone twice as far. The preference only applies inside the same
	 * walk band, so an unresolved place way out past the nearest one does not win.
	 */
	it('does not chase novelty beyond the walk band', () => {
		const spread = pack([place('close', ['sit'], north(1)), place('distant', ['sit'], north(20))]);
		const visited = new Set([cellKey(north(1).lat, north(1).lon)]);
		const [binding] = bindPlaces([sitNudge], spread, ORIGIN, { visited });

		expect(binding?.place.place.id).toBe('close');
		expect(binding?.fresh).toBe(false);
	});

	it('binds nothing when the pack holds nothing that fits', () => {
		expect(
			bindPlaces([{ id: 'e.task.swim', place_affordances: ['water'] }], sample, ORIGIN)
		).toEqual([]);
	});
});
