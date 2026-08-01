import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWeek, SHORTCUT_KEY, takeShortcutRoute } from '~/composables/useWatchBridge';

/**
 * The App Group handoff, in both directions.
 *
 * Outbound is the week string the watch and the widget render verbatim. Inbound is the route a
 * home-screen shortcut leaves behind: Swift parks it because a cold launch reaches the scene
 * delegate long before the webview exists, so there is no listener to post to. Reading it has to
 * clear it, or every subsequent launch would jump wherever the user last used a shortcut.
 */

const { get, remove, configure, platform } = vi.hoisted(() => ({
	get: vi.fn(async (_options: { key: string }) => ({ value: null }) as { value: string | null }),
	remove: vi.fn(async (_options: { key: string }) => {}),
	configure: vi.fn(async (_options: { group?: string }) => {}),
	platform: { name: 'ios' }
}));

vi.mock('@capacitor/preferences', () => ({ Preferences: { get, remove, configure } }));
vi.mock('@capacitor/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@capacitor/core')>();
	return {
		...actual,
		Capacitor: { ...actual.Capacitor, getPlatform: () => platform.name }
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	platform.name = 'ios';
	configure.mockImplementation(async () => {});
	get.mockImplementation(async () => ({ value: null }));
	remove.mockImplementation(async () => {});
});

describe('the week string', () => {
	it('gives one character per day, oldest first', () => {
		const week = encodeWeek([
			{ state: 'filled' },
			{ state: 'grace' },
			{ state: 'empty' },
			{ state: 'future' }
		]);
		expect(week).toBe('fge-');
	});

	// the watch parses by index, so a shorter or longer string silently shifts the ring
	it('is exactly as long as the week it was given', () => {
		expect(encodeWeek(Array.from({ length: 7 }, () => ({ state: 'filled' })))).toHaveLength(7);
	});

	/**
	 * A state the union does not know about degrades to empty rather than to `undefined`, which
	 * would serialise into the string as the four letters "unde" and desynchronise every day after
	 * it.
	 */
	it('degrades an unknown state to empty rather than corrupting the string', () => {
		expect(encodeWeek([{ state: 'filled' }, { state: 'sabbatical' }])).toBe('fe');
	});

	it('encodes an empty week as an empty string', () => {
		expect(encodeWeek([])).toBe('');
	});
});

describe('collecting a parked shortcut route', () => {
	it('returns nothing when no shortcut was used', async () => {
		expect(await takeShortcutRoute()).toBeNull();
		expect(remove, 'cleared a key that was never set').not.toHaveBeenCalled();
	});

	it('reads the route out of the shared suite', async () => {
		get.mockImplementation(async () => ({ value: '/tabs/playground' }));
		expect(await takeShortcutRoute()).toBe('/tabs/playground');
		expect(configure).toHaveBeenCalledWith({ group: 'group.com.earthapp.recess' });
		expect(get).toHaveBeenCalledWith({ key: SHORTCUT_KEY });
	});

	/**
	 * Reading is consuming. Leaving the key behind would make every later launch - including one
	 * from the icon, days later - jump to whichever tab a shortcut once pointed at.
	 */
	it('clears the route once it has been read', async () => {
		get.mockImplementation(async () => ({ value: '/tabs/week' }));
		await takeShortcutRoute();
		expect(remove).toHaveBeenCalledWith({ key: SHORTCUT_KEY });
	});

	// the value crosses a process boundary, so it is treated as untrusted input
	it('refuses anything that is not an in-app path', async () => {
		for (const value of ['https://example.com/tabs/today', 'tabs/today', '', 'javascript:x']) {
			get.mockImplementation(async () => ({ value }));
			expect(await takeShortcutRoute(), `${value} was accepted as a route`).toBeNull();
		}
	});

	it('reads nothing on a platform with no shortcuts', async () => {
		platform.name = 'web';
		get.mockImplementation(async () => ({ value: '/tabs/today' }));

		expect(await takeShortcutRoute()).toBeNull();
		expect(get).not.toHaveBeenCalled();
	});

	// an older plugin without group support throws on configure; that is not worth a crash
	it('degrades quietly when the shared suite is unavailable', async () => {
		configure.mockImplementation(async () => {
			throw new Error('no group support');
		});
		expect(await takeShortcutRoute()).toBeNull();
	});
});
