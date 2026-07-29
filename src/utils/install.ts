export const INSTALL_SEED_KEY = 'recess:install-seed';

/** 128 bits, hex encoded; enough that a collision is not worth reasoning about */
const SEED_BYTES = 16;

function randomSeed(): string {
	const bytes = new Uint8Array(SEED_BYTES);

	if (typeof globalThis.crypto?.getRandomValues === 'function') {
		// deliberately getRandomValues and not randomUUID: it is the one Crypto member
		// usable in an insecure context, so it does not depend on the Capacitor scheme
		globalThis.crypto.getRandomValues(bytes);
	} else {
		// no CSPRNG at all is not a real platform for this app, but a seed that throws
		// would take the whole first launch down with it
		for (let index = 0; index < bytes.length; index++) {
			bytes[index] = Math.floor(Math.random() * 256);
		}
	}

	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** a stored seed has to look like one, or a corrupt value would silently re-key the app */
export function isInstallSeed(value: unknown): value is string {
	return typeof value === 'string' && new RegExp(`^[0-9a-f]{${SEED_BYTES * 2}}$`).test(value);
}

let cached: string | null = null;
let pending: Promise<string> | null = null;

/**
 * Read the install seed, minting one on first launch.
 *
 * Written exactly once. Editing settings, replaying onboarding, or changing
 * interests must never re-key it - the Playground is a pure function of this seed
 * plus the ledger, so re-keying would silently redraw a scene the user has watched
 * grow. Only "Erase Everything" clears it, which is the one case where redrawing is
 * the point.
 */
export async function installSeed(): Promise<string> {
	if (cached !== null) return cached;

	// memoize the promise, not a flag: two concurrent first-launch callers would
	// otherwise both miss the read and mint two different seeds
	pending ??= (async () => {
		const { get, set } = useSettings();

		const stored = await get<unknown>(INSTALL_SEED_KEY, null);
		if (isInstallSeed(stored)) {
			cached = stored;
			return stored;
		}

		const minted = randomSeed();
		await set(INSTALL_SEED_KEY, minted);
		cached = minted;
		return minted;
	})();

	return pending;
}

/**
 * The seed as currently known, without touching storage.
 *
 * Returns `''` before `installSeed()` has resolved. Callers on the synchronous path
 * (the day picker, the scene builder) take it as an input rather than awaiting, and
 * an empty seed degrades to the old locale-and-day-only behaviour rather than
 * throwing.
 */
export function installSeedSync(): string {
	return cached ?? '';
}

/** test seam; also what "Erase Everything" calls so the next read mints afresh */
export function resetInstallSeedCache() {
	cached = null;
	pending = null;
}
