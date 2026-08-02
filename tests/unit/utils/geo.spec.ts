import {
	bearingDegrees,
	compassPoint,
	DEFAULT_REACH_MAX_METRES,
	distanceMetres,
	GRID_METRES,
	isCoordinate,
	reachability,
	sameCell,
	snapToGrid,
	WALK_METRES_PER_MINUTE,
	walkMinutes
} from '~/utils/geo';

const CHICAGO = { latitude: 41.8819, longitude: -87.6278 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

describe('isCoordinate', () => {
	it('accepts a real pair', () => {
		expect(isCoordinate(CHICAGO)).toBe(true);
	});

	it.each([
		['null', null],
		['a string', '41.88,-87.62'],
		['a missing longitude', { latitude: 41.88 }],
		['a null latitude', { latitude: null, longitude: -87.62 }],
		['NaN', { latitude: Number.NaN, longitude: -87.62 }],
		['Infinity', { latitude: 41.88, longitude: Number.POSITIVE_INFINITY }],
		['an out-of-range latitude', { latitude: 91, longitude: 0 }],
		['an out-of-range longitude', { latitude: 0, longitude: 181 }]
	])('rejects %s', (_label, value) => {
		expect(isCoordinate(value)).toBe(false);
	});
});

describe('snapToGrid', () => {
	it('is deterministic', () => {
		expect(snapToGrid(CHICAGO.latitude, CHICAGO.longitude)).toEqual(
			snapToGrid(CHICAGO.latitude, CHICAGO.longitude)
		);
	});

	it('is idempotent, so a stored position never drifts on re-snap', () => {
		const once = snapToGrid(CHICAGO.latitude, CHICAGO.longitude);
		const twice = snapToGrid(once.latitude, once.longitude);
		expect(twice).toEqual(once);
	});

	/**
	 * The actual privacy guarantee. Polakis et al. showed that rounding and noise both leak
	 * position through result ordering; a fixed grid does not, because every input inside a cell
	 * produces byte-identical output and there is no residual left to order by.
	 */
	it('collapses every position inside one cell to the same output', () => {
		const base = snapToGrid(CHICAGO.latitude, CHICAGO.longitude);

		// a spread of offsets well under half a cell, in both axes and both signs
		for (const dLat of [-0.0002, -0.0001, 0, 0.0001, 0.0002]) {
			for (const dLon of [-0.0003, -0.0001, 0, 0.0001, 0.0003]) {
				const nudged = snapToGrid(CHICAGO.latitude + dLat, CHICAGO.longitude + dLon);
				expect(sameCell(nudged, base)).toBe(true);
			}
		}
	});

	it('separates positions that are genuinely far apart', () => {
		const here = snapToGrid(CHICAGO.latitude, CHICAGO.longitude);
		const there = snapToGrid(CHICAGO.latitude + 0.01, CHICAGO.longitude);
		expect(sameCell(here, there)).toBe(false);
	});

	it('keeps cells roughly square and roughly GRID_METRES across, at several latitudes', () => {
		/** walk outwards until the snapped value changes, which finds the neighbouring cell */
		const nextCell = (latitude: number, longitude: number, axis: 'lat' | 'lon') => {
			const origin = snapToGrid(latitude, longitude);
			for (let step = 1; step <= 4000; step++) {
				const delta = step * 0.00002;
				const probe =
					axis === 'lat'
						? snapToGrid(latitude + delta, longitude)
						: snapToGrid(latitude, longitude + delta);
				if (probe.latitude !== origin.latitude || probe.longitude !== origin.longitude) {
					return probe;
				}
			}
			throw new Error('no neighbouring cell found');
		};

		for (const latitude of [0, 41.88, 51.5, -33.87, 64]) {
			const origin = snapToGrid(latitude, 0);
			const northSouth = distanceMetres(origin, nextCell(latitude, 0, 'lat'));
			const eastWest = distanceMetres(origin, nextCell(latitude, 0, 'lon'));

			// one cell across, on each axis, within a tolerance the cos() approximation allows
			expect(northSouth).toBeGreaterThan(GRID_METRES * 0.85);
			expect(northSouth).toBeLessThan(GRID_METRES * 1.15);
			expect(eastWest).toBeGreaterThan(GRID_METRES * 0.85);
			expect(eastWest).toBeLessThan(GRID_METRES * 1.15);
		}
	});

	it('does not blow up near the poles', () => {
		const polar = snapToGrid(89.9, 137);
		expect(Number.isFinite(polar.latitude)).toBe(true);
		expect(Number.isFinite(polar.longitude)).toBe(true);
		expect(Math.abs(polar.latitude)).toBeLessThanOrEqual(90);
	});

	it('honours a custom cell size', () => {
		const coarse = snapToGrid(CHICAGO.latitude, CHICAGO.longitude, 1000);
		const fine = snapToGrid(CHICAGO.latitude, CHICAGO.longitude, 100);
		// a kilometre cell cannot be closer to the truth than a hundred-metre one
		expect(distanceMetres(coarse, CHICAGO)).toBeGreaterThanOrEqual(
			distanceMetres(fine, CHICAGO) - 1
		);
	});
});

describe('distanceMetres', () => {
	it('is zero for a point against itself', () => {
		expect(distanceMetres(CHICAGO, CHICAGO)).toBe(0);
	});

	it('is symmetric', () => {
		expect(distanceMetres(CHICAGO, LONDON)).toBeCloseTo(distanceMetres(LONDON, CHICAGO), 6);
	});

	// Chicago to London is ~6360 km; a haversine on a sphere lands within a percent
	it('matches a known long distance', () => {
		expect(distanceMetres(CHICAGO, LONDON) / 1000).toBeGreaterThan(6300);
		expect(distanceMetres(CHICAGO, LONDON) / 1000).toBeLessThan(6400);
	});

	it('matches a known short distance', () => {
		// 0.001 degrees of latitude is ~111 m anywhere
		const north = { ...CHICAGO, latitude: CHICAGO.latitude + 0.001 };
		expect(distanceMetres(CHICAGO, north)).toBeCloseTo(111.2, 0);
	});
});

describe('bearingDegrees', () => {
	it.each([
		['north', { latitude: 1, longitude: 0 }, 0],
		['east', { latitude: 0, longitude: 1 }, 90],
		['south', { latitude: -1, longitude: 0 }, 180],
		['west', { latitude: 0, longitude: -1 }, 270]
	])('reads %s correctly', (_label, to, expected) => {
		expect(bearingDegrees({ latitude: 0, longitude: 0 }, to)).toBeCloseTo(expected, 4);
	});

	it('always lands in [0, 360)', () => {
		for (const lon of [-179, -90, -1, 0, 1, 90, 179]) {
			const value = bearingDegrees(CHICAGO, { latitude: 10, longitude: lon });
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(360);
		}
	});
});

describe('compassPoint', () => {
	it.each([
		[0, 'n'],
		[44, 'ne'],
		[90, 'e'],
		[135, 'se'],
		[180, 's'],
		[225, 'sw'],
		[270, 'w'],
		[315, 'nw'],
		[359, 'n']
	])('maps %i degrees to %s', (bearing, expected) => {
		expect(compassPoint(bearing)).toBe(expected);
	});

	it('handles out-of-range input rather than returning undefined', () => {
		expect(compassPoint(-90)).toBe('w');
		expect(compassPoint(720)).toBe('n');
	});
});

describe('walkMinutes', () => {
	it('turns a distance into minutes at the preferred speed', () => {
		expect(walkMinutes(WALK_METRES_PER_MINUTE)).toBeCloseTo(1, 6);
		// the NHTS median walk trip, ~400 m, should read as about five minutes
		expect(walkMinutes(400)).toBeGreaterThan(4);
		expect(walkMinutes(400)).toBeLessThan(6);
	});
});

describe('reachability', () => {
	it('is 1 at zero distance', () => {
		expect(reachability(0)).toBe(1);
	});

	it('decays monotonically', () => {
		let previous = Number.POSITIVE_INFINITY;
		for (const metres of [0, 100, 400, 800, 1600, 3200]) {
			const value = reachability(metres);
			expect(value).toBeLessThan(previous);
			previous = value;
		}
	});

	// the two anchors the form was chosen against
	it('scores the NHTS median and mean walk trips as documented', () => {
		expect(reachability(400)).toBeCloseTo(0.368, 2);
		expect(reachability(800)).toBeCloseTo(0.135, 2);
	});

	it('has decayed to ~1.8% at d_max', () => {
		expect(reachability(DEFAULT_REACH_MAX_METRES)).toBeCloseTo(0.018, 3);
	});

	it('never reaches zero, so nothing can be excluded by distance alone', () => {
		expect(reachability(100_000)).toBeGreaterThan(0);
	});

	it('degrades to a no-op rather than dividing by zero on a bad max', () => {
		expect(reachability(500, 0)).toBe(1);
		expect(reachability(500, -1)).toBe(1);
	});

	it('widens with a larger max', () => {
		expect(reachability(800, 3200)).toBeGreaterThan(reachability(800, 1600));
	});
});
