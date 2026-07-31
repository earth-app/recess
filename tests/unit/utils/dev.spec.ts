import { beforeEach, describe, expect, it } from 'vitest';
import {
	DEV_CONTEXT_DEFAULTS,
	DEV_MODE,
	devContext,
	devForceBonus,
	devOverrides,
	devOverridesActive,
	devPacksInstalled,
	devPinnedNudgeIds,
	devUnlockEverything,
	devVerdict,
	resetDevOverrides,
	setDevOverrides
} from '~/utils/dev';

// This module is the one part of dev mode that ships in a production bundle, so its
// pass-through behaviour is load-bearing rather than incidental. The unit lane runs
// without NUXT_PUBLIC_DEV_MODE, so DEV_MODE is false here and these assert exactly
// the production shape: every reader returns the untouched value and every writer is
// a no-op.
describe('dev overrides', () => {
	beforeEach(() => {
		resetDevOverrides();
	});

	it('is off in the gate lane, which is what the rest of this file asserts against', () => {
		expect(DEV_MODE).toBe(false);
	});

	it('reports nothing active', () => {
		expect(devOverridesActive()).toBe(false);
	});

	it('ignores every write, so no production code path can be steered by it', () => {
		setDevOverrides({
			pinnedNudgeIds: ['nature.notice.first_bird'],
			verdict: 'passed',
			packsInstalled: [],
			unlockEverything: true,
			forceBonus: true
		});

		expect(devPinnedNudgeIds()).toEqual([]);
		expect(devVerdict()).toBeNull();
		expect(devUnlockEverything()).toBe(false);
		expect(devForceBonus()).toBe(false);
		expect(devOverridesActive()).toBe(false);
	});

	it('passes the real pack list straight through', () => {
		const actual = ['vision', 'text'];
		expect(devPacksInstalled(actual)).toBe(actual);

		setDevOverrides({ packsInstalled: [] });
		expect(devPacksInstalled(actual)).toBe(actual);
	});

	it('returns no context override, so the real clock and sky are used', () => {
		expect(devContext()).toBeNull();
	});

	it('exposes the override object without a way to activate it', () => {
		// the panel reads this object directly; with DEV_MODE off it stays at defaults
		expect(devOverrides().context).toEqual(DEV_CONTEXT_DEFAULTS);
		expect(devOverrides().pinnedNudgeIds).toEqual([]);
	});

	it('resets without throwing even though there is nothing to reset', () => {
		expect(() => resetDevOverrides()).not.toThrow();
	});
});
