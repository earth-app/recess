import { isPositionUsable } from '~/composables/usePosition';
import type { NudgeContext, WeatherSnapshot } from '~/types/context';
import type { ModelPack } from '~/types/nudge';
import { dayKey, moonIllumination, moonPhaseFor, seasonFor, timeOfDayFor } from '~/utils/day';
import { devContext, devPacksInstalled } from '~/utils/dev';
import { reachabilityIndex } from '~/utils/places';
import { daylightRemaining } from '~/utils/sun';

// Assembles everything the filter engine reads. Deliberately synchronous and
// pure given its inputs, so tests can build a context by hand and the store can
// rebuild one cheaply on every tick.

export interface ContextInputs {
	now?: Date;
	latitude?: number;
	longitude?: number;
}

export function useNudgeContext() {
	const settings = useAppSettingsState();
	const progress = useProgressStore();
	const models = useModelsStore();
	const { granted } = usePermissions();
	const { snapshot } = useWeather();
	const { snapshot: position } = usePosition();
	const { pack } = useAreas();

	function build(inputs: ContextInputs = {}): NudgeContext {
		const now = inputs.now ?? new Date();
		const dev = devContext();
		let weather = snapshot.value ?? undefined;

		/**
		 * The cached position is the source, and the weather snapshot is only a fallback.
		 *
		 * This used to read coordinates out of the weather snapshot alone, which never worked on a
		 * fresh install: `useWeather.refresh` needs coordinates to fetch, and the only supplier of
		 * coordinates was the snapshot it had not fetched yet. Neither side ever populated, so
		 * `ctx.weather` stayed undefined forever and every weather, temperature, wind, humidity,
		 * UV and daylight filter returned UNKNOWN for the life of the install.
		 *
		 * Reading from the cache and never prompting here is deliberate: the deck must stay
		 * deterministic for the day (see `stores/nudges.ts` on why the pick is persisted), so a
		 * fix that lands mid-session updates the cache for tomorrow rather than re-picking today.
		 */
		const stored = isPositionUsable(position.value ?? null, now.getTime())
			? (position.value ?? undefined)
			: undefined;

		const latitude = dev?.latitude ?? inputs.latitude ?? stored?.latitude ?? weather?.latitude;
		const longitude = dev?.longitude ?? inputs.longitude ?? stored?.longitude ?? weather?.longitude;

		if (dev && (dev.weather !== null || dev.temperature !== null)) {
			// a synthetic snapshot rather than a mutated one; the real cache stays intact
			const base: WeatherSnapshot = weather ?? {
				code: 0,
				condition: 'clear',
				temperature_c: 18,
				wind_speed_kmh: 0,
				humidity: 50,
				uv_index: 0,
				is_day: true,
				fetched_at: now.getTime(),
				latitude: latitude ?? 0,
				longitude: longitude ?? 0
			};

			weather = {
				...base,
				...(dev.weather !== null ? { condition: dev.weather } : {}),
				...(dev.temperature !== null ? { temperature_c: dev.temperature } : {})
			};
		}

		const coordinate =
			latitude !== undefined && longitude !== undefined ? { latitude, longitude } : null;
		// one pass over the pack, shared by the nearby filter and the recommender's bump
		const reach = reachabilityIndex(pack.value, coordinate);

		return {
			now,
			day: dayKey(now),
			hour: dev?.hour ?? now.getHours(),
			weekday: now.getDay(),
			time_of_day: dev?.time_of_day ?? timeOfDayFor(now),
			season: dev?.season ?? seasonFor(now, latitude),
			moon_phase: dev?.moon_phase ?? moonPhaseFor(now),
			moon_illumination: dev?.moon_illumination ?? moonIllumination(now),
			locale: settings.value.locale,
			points: progress.points,
			streak_days: progress.streak.current,
			completed_today: progress.resolvedToday.length,
			completions: progress.completions,
			granted_permissions: [...granted.value],
			installed_packs: devPacksInstalled([...models.installed]) as ModelPack[],
			weather,
			daylight_remaining:
				latitude !== undefined && longitude !== undefined
					? daylightRemaining(now, latitude, longitude)
					: undefined,
			latitude,
			longitude,
			reachable_affordances: reach?.affordances,
			reachability: reach?.scores
		};
	}

	return { build };
}
