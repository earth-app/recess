export interface Coordinate {
	latitude: number;
	longitude: number;
}

// #region grid snapping

/** metres per degree of latitude; constant enough at this precision */
const METRES_PER_DEGREE_LAT = 111_320;

/**
 * Edge length of the privacy grid, in metres.
 *
 * 100 m is fine enough that "a bench 400 m away" stays useful and coarse enough that a cell
 * holds a whole block. Everything the app stores, compares or shares is snapped to it.
 */
export const GRID_METRES = 100;

/** clamp into the range the projection is defined on; the poles are not a real use case */
const MAX_LATITUDE = 85;

export function isCoordinate(value: unknown): value is Coordinate {
	if (!value || typeof value !== 'object') return false;
	const record = value as Partial<Coordinate>;
	return (
		typeof record.latitude === 'number' &&
		Number.isFinite(record.latitude) &&
		Math.abs(record.latitude) <= 90 &&
		typeof record.longitude === 'number' &&
		Number.isFinite(record.longitude) &&
		Math.abs(record.longitude) <= 180
	);
}

/**
 * Snap a position onto a fixed global grid.
 *
 * This is a privacy mechanism, not a rounding convenience, and the distinction is load-bearing.
 * Polakis et al. (CCS 2015) recovered Grindr users' positions to 98% accuracy within 19 m *with
 * the distance readout hidden*, using only the ordering of results - and showed that both
 * rounding-to-decimals and adding noise fail against it, because repeated observations average
 * the noise away and ordering leaks the residual. Snapping the *input* to a fixed grid is the one
 * mitigation with a guarantee: every position inside a cell produces byte-identical output, so
 * there is no residual left to order by.
 *
 * The grid is global and absolute, never relative to the user - a per-user origin would itself be
 * an identifier. Longitude cells are widened by 1/cos(lat) so a cell stays roughly square in
 * metres, and the widening uses the *already snapped* latitude so the result is a pure function
 * of the cell rather than of where inside it the caller happened to be.
 */
export function snapToGrid(
	latitude: number,
	longitude: number,
	metres: number = GRID_METRES
): Coordinate {
	const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));

	const stepLat = metres / METRES_PER_DEGREE_LAT;
	const snappedLat = Math.round(clampedLat / stepLat) * stepLat;

	// cos of the snapped latitude, floored so a near-polar cell cannot divide by ~0
	const shrink = Math.max(0.01, Math.cos((snappedLat * Math.PI) / 180));
	const stepLon = metres / (METRES_PER_DEGREE_LAT * shrink);
	const snappedLon = Math.round(longitude / stepLon) * stepLon;

	// rounded to a stable number of places so the same cell always serialises identically
	return {
		latitude: Number(snappedLat.toFixed(6)),
		longitude: Number(snappedLon.toFixed(6))
	};
}

/** true when two positions land in the same grid cell, which is what "here" means */
export function sameCell(a: Coordinate, b: Coordinate, metres: number = GRID_METRES): boolean {
	const left = snapToGrid(a.latitude, a.longitude, metres);
	const right = snapToGrid(b.latitude, b.longitude, metres);
	return left.latitude === right.latitude && left.longitude === right.longitude;
}

// #endregion

// #region distance and bearing

const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** great-circle distance in metres */
export function distanceMetres(from: Coordinate, to: Coordinate): number {
	const lat1 = toRadians(from.latitude);
	const lat2 = toRadians(to.latitude);
	const deltaLat = lat2 - lat1;
	const deltaLon = toRadians(to.longitude - from.longitude);

	const a =
		Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** initial bearing in degrees clockwise from north, in [0, 360) */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
	const lat1 = toRadians(from.latitude);
	const lat2 = toRadians(to.latitude);
	const deltaLon = toRadians(to.longitude - from.longitude);

	const y = Math.sin(deltaLon) * Math.cos(lat2);
	const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** the eight-point compass name for a bearing, for the non-visual description of the field map */
export const COMPASS_POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

export function compassPoint(bearing: number): CompassPoint {
	const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
	return COMPASS_POINTS[index] as CompassPoint;
}

// #endregion

// #region walking

/**
 * Preferred walking speed, metres per minute.
 *
 * 1.4 m/s is the long-standing central estimate for adult preferred walking speed on the level,
 * which is 84 m/min. Used only to turn a distance into a legible "N min" - never to promise an
 * arrival time, because there is no routing here and the straight-line distance understates the
 * walk.
 */
export const WALK_METRES_PER_MINUTE = 84;

export function walkMinutes(metres: number): number {
	return metres / WALK_METRES_PER_MINUTE;
}

/**
 * Outer limit of the reachability curve, in metres.
 *
 * The 2001 NHTS puts the median walk trip at a quarter mile (~400 m) and the mean at about half a
 * mile; ~75% of adults call up to half a mile and up to 10 minutes reasonable. 1600 m is a ~20 min
 * walk, comfortably past that, and is the distance at which the weight below has decayed to ~1.8%.
 *
 * Swept by `tests/eval/recommend.ts` rather than hand-tuned - see `RecommendTuning`.
 */
export const DEFAULT_REACH_MAX_METRES = 1600;

/**
 * Willingness to walk a given distance, in (0, 1].
 *
 * Negative exponential `exp(-beta * d)`, which the pedestrian-accessibility literature prefers
 * over power-law and Gaussian forms precisely because walking trips are short. `beta = 4 / d_max`
 * is the standard anchoring convention (cityseer), putting `exp(-4) ~ 1.8%` at `d_max`.
 *
 * At the 1600 m default: 400 m scores 0.37, 800 m scores 0.14.
 */
export function reachability(metres: number, maxMetres: number = DEFAULT_REACH_MAX_METRES): number {
	if (!(maxMetres > 0)) return 1;
	const beta = 4 / maxMetres;
	return Math.exp(-beta * Math.max(0, metres));
}

// #endregion
