import { Capacitor } from '@capacitor/core';
import {
	POSITION_MAX_AGE_MS,
	POSITION_USABLE_AGE_MS,
	type PositionSnapshot
} from '~/types/context';
import { snapToGrid } from '~/utils/geo';

export const POSITION_KEY = 'recess.position.v1';

/**
 * Own timeout rather than trusting the plugin's.
 *
 * `getCurrentPosition`'s `timeout` option is not reliably honoured across Android OEM builds, so
 * the call is raced against this. 8s matches the weather fetch.
 */
const FIX_TIMEOUT_MS = 8000;

/**
 * Accept a system fix up to five minutes old.
 *
 * This is the single biggest battery win available here: a non-zero `maximumAge` lets the OS hand
 * back a cached fix instead of powering the radio, and for "which neighbourhood am I in" a
 * five-minute-old answer is indistinguishable from a fresh one.
 */
const ACCEPT_CACHED_MS = 5 * 60 * 1000;

const snapshot = ref<PositionSnapshot | null>(null);
const locating = ref(false);
/** permission was refused and asking again would do nothing; only Settings can undo it */
const blocked = ref(false);
let inFlight: Promise<PositionSnapshot | null> | null = null;

export function isPositionFresh(value: PositionSnapshot | null, now = Date.now()): boolean {
	if (!value) return false;
	return value.manual || now - value.fetched_at <= POSITION_MAX_AGE_MS;
}

/** still good enough to feed the filter context; see POSITION_USABLE_AGE_MS for why this differs */
export function isPositionUsable(value: PositionSnapshot | null, now = Date.now()): boolean {
	if (!value) return false;
	return value.manual || now - value.fetched_at <= POSITION_USABLE_AGE_MS;
}

function finite(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validate a stored position rather than trusting its shape.
 *
 * Same reasoning as `parseWeatherSnapshot`: there is no server to correct a bad read, and a field
 * that survived as `null` would be used as 0 - which is a real coordinate in the Gulf of Guinea,
 * so every distance in the app would be wrong by thousands of kilometres while looking plausible.
 * Rejecting the whole record means "position unknown", which every consumer already handles.
 */
export function parsePositionSnapshot(raw: unknown): PositionSnapshot | null {
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Partial<Record<keyof PositionSnapshot, unknown>>;

	const latitude = finite(record.latitude);
	const longitude = finite(record.longitude);
	const fetchedAt = finite(record.fetched_at);

	if (
		latitude === null ||
		longitude === null ||
		fetchedAt === null ||
		Math.abs(latitude) > 90 ||
		Math.abs(longitude) > 180
	) {
		return null;
	}

	// re-snapped on read: a record written by an older grid size must not survive unsnapped
	const cell = snapToGrid(latitude, longitude);

	return {
		latitude: cell.latitude,
		longitude: cell.longitude,
		accuracy: finite(record.accuracy),
		fetched_at: fetchedAt,
		manual: record.manual === true
	};
}

export function usePosition() {
	const { get, set, remove } = useSettings();
	const { check, require: requirePermission } = usePermissions();

	async function hydrate(): Promise<PositionSnapshot | null> {
		if (snapshot.value) return snapshot.value;
		snapshot.value = parsePositionSnapshot(await get<unknown>(POSITION_KEY, null));
		return snapshot.value;
	}

	async function store(next: PositionSnapshot) {
		snapshot.value = next;
		await set(POSITION_KEY, next);
	}

	/**
	 * Ask the OS for a fix.
	 *
	 * Returns the cached snapshot on every failure path rather than throwing - a missing position
	 * makes the place filters pass, so nothing upstream needs to handle an error.
	 */
	async function locate(options: { force?: boolean } = {}): Promise<PositionSnapshot | null> {
		await hydrate();

		if (!options.force && isPositionFresh(snapshot.value)) return snapshot.value;
		// a hand-pinned area is the user's assertion; never silently replace it
		if (!options.force && snapshot.value?.manual) return snapshot.value;
		if (inFlight) return inFlight;

		locating.value = true;
		inFlight = (async () => {
			try {
				if (!(await check('location'))) {
					const granted = await requirePermission('location');
					if (!granted) {
						// denied and restricted are indistinguishable - PermissionState has no
						// `restricted` - so both are treated as "no location, offer manual"
						blocked.value = true;
						return snapshot.value;
					}
				}
				blocked.value = false;

				if (!Capacitor.isNativePlatform() && typeof navigator === 'undefined') {
					return snapshot.value;
				}

				const { Geolocation } = await import('@capacitor/geolocation');

				const fix = await Promise.race([
					Geolocation.getCurrentPosition({
						enableHighAccuracy: false,
						timeout: FIX_TIMEOUT_MS,
						maximumAge: ACCEPT_CACHED_MS
					}),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS))
				]);

				const latitude = finite(fix?.coords?.latitude);
				const longitude = finite(fix?.coords?.longitude);
				if (latitude === null || longitude === null) return snapshot.value;

				const cell = snapToGrid(latitude, longitude);
				const next: PositionSnapshot = {
					...cell,
					accuracy: finite(fix?.coords?.accuracy),
					fetched_at: Date.now(),
					manual: false
				};

				await store(next);
				return next;
			} catch {
				return snapshot.value;
			} finally {
				locating.value = false;
				inFlight = null;
			}
		})();

		return inFlight;
	}

	/** the equal-weight alternative to granting location, so refusing costs nothing */
	async function setManual(latitude: number, longitude: number): Promise<PositionSnapshot> {
		const cell = snapToGrid(latitude, longitude);
		const next: PositionSnapshot = {
			...cell,
			accuracy: null,
			fetched_at: Date.now(),
			manual: true
		};
		await store(next);
		return next;
	}

	async function clear() {
		snapshot.value = null;
		blocked.value = false;
		await remove(POSITION_KEY);
	}

	return {
		snapshot: readonly(snapshot),
		locating: readonly(locating),
		blocked: readonly(blocked),
		fresh: computed(() => isPositionFresh(snapshot.value)),
		usable: computed(() => isPositionUsable(snapshot.value)),
		hydrate,
		locate,
		setManual,
		clear
	};
}
