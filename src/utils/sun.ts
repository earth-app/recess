// NOAA sunrise/sunset approximation. accurate to about a minute at temperate
// latitudes, which is far better than a nudge filter needs.

const DEG = Math.PI / 180;

function dayOfYear(date: Date): number {
	const start = Date.UTC(date.getUTCFullYear(), 0, 0);
	const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	return Math.round((current - start) / 86_400_000);
}

export interface SunTimes {
	/** ms timestamps; null when the sun never crosses the horizon that day */
	sunrise: number | null;
	sunset: number | null;
	/** true above the arctic/antarctic circle in midsummer */
	alwaysUp: boolean;
	alwaysDown: boolean;
}

/**
 * `zenith` 90.833 is the standard solar-disc-plus-refraction value for
 * sunrise/sunset. returns utc ms timestamps on the same calendar day as `date`.
 */
export function sunTimes(
	date: Date,
	latitude: number,
	longitude: number,
	zenith = 90.833
): SunTimes {
	const n = dayOfYear(date);
	const lngHour = longitude / 15;

	const compute = (rising: boolean): number | null => {
		const t = n + ((rising ? 6 : 18) - lngHour) / 24;

		// mean anomaly -> true longitude
		const m = 0.9856 * t - 3.289;
		let l = m + 1.916 * Math.sin(m * DEG) + 0.02 * Math.sin(2 * m * DEG) + 282.634;
		l = ((l % 360) + 360) % 360;

		// right ascension, forced into the same quadrant as the true longitude
		let ra = Math.atan(0.91764 * Math.tan(l * DEG)) / DEG;
		ra = ((ra % 360) + 360) % 360;
		const lQuadrant = Math.floor(l / 90) * 90;
		const raQuadrant = Math.floor(ra / 90) * 90;
		ra = (ra + (lQuadrant - raQuadrant)) / 15;

		const sinDec = 0.39782 * Math.sin(l * DEG);
		const cosDec = Math.cos(Math.asin(sinDec));

		const cosH =
			(Math.cos(zenith * DEG) - sinDec * Math.sin(latitude * DEG)) /
			(cosDec * Math.cos(latitude * DEG));
		if (cosH > 1 || cosH < -1) return null; // sun never reaches the zenith today

		const h = (rising ? 360 - Math.acos(cosH) / DEG : Math.acos(cosH) / DEG) / 15;
		const localMean = h + ra - 0.06571 * t - 6.622;
		const utcHours = (((localMean - lngHour) % 24) + 24) % 24;

		return (
			Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + utcHours * 3_600_000
		);
	};

	const sunrise = compute(true);
	const sunset = compute(false);

	if (sunrise === null || sunset === null) {
		// polar day vs polar night: check which side of the horizon the sun sits on
		const declination =
			0.39782 * Math.sin((0.9856 * n - 3.289 + 282.634) * DEG) > 0 ? 'north' : 'south';
		const up =
			(latitude >= 0 && declination === 'north') || (latitude < 0 && declination === 'south');
		return { sunrise: null, sunset: null, alwaysUp: up, alwaysDown: !up };
	}

	return { sunrise, sunset, alwaysUp: false, alwaysDown: false };
}

/**
 * minutes until sunset. negative once the sun is down, and `Infinity` during a
 * polar day so "there is still light" filters pass rather than block.
 */
export function daylightRemaining(
	now: Date,
	latitude: number,
	longitude: number
): number | undefined {
	const { sunset, alwaysUp, alwaysDown } = sunTimes(now, latitude, longitude);
	if (alwaysUp) return Number.POSITIVE_INFINITY;
	if (alwaysDown) return Number.NEGATIVE_INFINITY;
	if (sunset === null) return undefined;
	return Math.round((sunset - now.getTime()) / 60_000);
}

export function isDaylight(now: Date, latitude: number, longitude: number): boolean | undefined {
	const { sunrise, sunset, alwaysUp, alwaysDown } = sunTimes(now, latitude, longitude);
	if (alwaysUp) return true;
	if (alwaysDown) return false;
	if (sunrise === null || sunset === null) return undefined;
	const t = now.getTime();
	return t >= sunrise && t <= sunset;
}
