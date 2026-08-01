import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingTimes from '~/components/onboarding/Times.vue';
import { slotDate } from '~/composables/useLocalNotifications';
import type { AppSettings } from '~/composables/useSettings';

/**
 * The onboarding step that sets the three digest times.
 *
 * `ion-datetime` speaks ISO, the scheduler speaks `HH:MM`, and the conversion between them is the
 * whole component. It must stay a wall clock in both directions: `slotDate` rebuilds the moment with
 * `setHours`, which is local, so a value that arrives with an offset has to keep the digits the user
 * picked rather than being reinterpreted through the device's zone.
 */

type Times = { morning: string; midday: string; evening: string };

const { setTimes, init, saved, isNative, requireNotifications } = vi.hoisted(() => ({
	setTimes: vi.fn(async (_times: Times) => {}),
	init: vi.fn(async () => {}),
	saved: vi.fn((): Partial<AppSettings> => ({})),
	isNative: vi.fn(() => false),
	requireNotifications: vi.fn(async () => true)
}));

vi.mock('@capacitor/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@capacitor/core')>();
	return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: isNative } };
});

vi.mock('~/composables/useOnboarding', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useOnboarding')>();
	return { ...actual, useOnboarding: () => ({ ...actual.useOnboarding(), setTimes }) };
});

vi.mock('~/composables/usePermissions', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/usePermissions')>();
	return {
		...actual,
		usePermissions: () => ({ ...actual.usePermissions(), require: requireNotifications })
	};
});

vi.mock('~/composables/useSettings', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useSettings')>();
	return {
		...actual,
		useAppSettings: () => {
			const settings = actual.useAppSettingsState();
			settings.value = { ...actual.APP_SETTINGS_DEFAULTS, ...saved() };
			return {
				settings,
				initialized: ref(true),
				init,
				setValue: vi.fn(),
				resetToDefaults: vi.fn()
			};
		}
	};
});

/** the picker only reaches the dom through a real input; IonModal swallows its slot */
const Picker = {
	props: ['value'],
	emits: ['ion-change'],
	template:
		'<input :value="value" @input="$emit(\'ion-change\', { detail: { value: $event.target.value } })" />'
};
const stubs = { IonModal: { template: '<div><slot /></div>' }, IonDatetime: Picker };

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof OnboardingTimes>>>;
let mounted: Wrapper | null = null;

/** the saved times and the permission check both settle in `onMounted` */
async function step() {
	mounted = await mountSuspended(OnboardingTimes, { global: { stubs } });
	await new Promise((r) => setTimeout(r, 0));
	await mounted.vm.$nextTick();
	return mounted;
}

const picker = (w: Wrapper, slot: keyof Times) => w.find(`#onboarding-time-${slot}`);
const shown = (w: Wrapper, slot: keyof Times) =>
	(picker(w, slot).element as HTMLInputElement).value;

async function pick(w: Wrapper, slot: keyof Times, iso: string) {
	await picker(w, slot).setValue(iso);
	await w.vm.$nextTick();
}

const lastSaved = () => setTimes.mock.lastCall?.[0];

beforeEach(() => {
	vi.clearAllMocks();
	saved.mockReturnValue({});
	isNative.mockReturnValue(false);
	requireNotifications.mockResolvedValue(true);
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('what it starts at', () => {
	it('opens at the three default digest times', async () => {
		const w = await step();

		expect(shown(w, 'morning')).toBe('2000-01-01T08:30:00');
		expect(shown(w, 'midday')).toBe('2000-01-01T13:00:00');
		expect(shown(w, 'evening')).toBe('2000-01-01T18:30:00');
	});

	it('shows the times a resumed run already saved', async () => {
		saved.mockReturnValue({ morningTime: '07:05', middayTime: '12:10', eveningTime: '21:45' });
		const w = await step();

		expect(shown(w, 'morning')).toBe('2000-01-01T07:05:00');
		expect(shown(w, 'midday')).toBe('2000-01-01T12:10:00');
		expect(shown(w, 'evening')).toBe('2000-01-01T21:45:00');
	});

	it('writes nothing before a time is touched', async () => {
		await step();
		expect(setTimes, 'mounting the step rewrote the saved times').not.toHaveBeenCalled();
	});
});

describe('changing a time', () => {
	it('saves the new clock and leaves the other two alone', async () => {
		const w = await step();
		await pick(w, 'morning', '2000-01-01T07:15:00');

		expect(lastSaved()).toEqual({ morning: '07:15', midday: '13:00', evening: '18:30' });
	});

	it('keeps both edits when two slots change', async () => {
		const w = await step();
		await pick(w, 'morning', '2000-01-01T06:45:00');
		await pick(w, 'evening', '2000-01-01T20:00:00');

		expect(lastSaved()).toEqual({ morning: '06:45', midday: '13:00', evening: '20:00' });
	});

	it('shows the change back in the picker', async () => {
		const w = await step();
		await pick(w, 'midday', '2000-01-01T11:20:00');

		expect(shown(w, 'midday')).toBe('2000-01-01T11:20:00');
		expect(shown(w, 'morning'), 'one edit moved another slot').toBe('2000-01-01T08:30:00');
	});
});

describe('the clock it stores', () => {
	it('stores a form the digest scheduler reads back', async () => {
		const w = await step();
		await pick(w, 'morning', '2000-01-01T07:15:00');

		const at = slotDate(new Date(2026, 6, 28), lastSaved()!.morning);
		expect(at.getHours()).toBe(7);
		expect(at.getMinutes()).toBe(15);
	});

	/**
	 * The parse reads the digits out of the string rather than through `new Date`, so the stored clock
	 * is the one the wheel showed in every timezone. Two offsets, because a `new Date` parse can only
	 * agree with one of them wherever the test happens to run - and shifts the other.
	 */
	it('keeps the wall clock whatever offset the value carries', async () => {
		const w = await step();
		await pick(w, 'evening', '2026-07-28T19:40:00+02:00');
		const east = lastSaved()!.evening;

		await pick(w, 'evening', '2026-07-28T19:40:00-11:00');
		expect(east, 'the picked hour was reinterpreted through the local zone').toBe('19:40');
		expect(lastSaved()!.evening).toBe('19:40');
	});

	it('pads a single-digit hour', async () => {
		const w = await step();
		await pick(w, 'morning', '2000-01-01T7:05:00');

		expect(lastSaved()!.morning).toBe('07:05');
	});

	it('falls back to the slot default on an impossible clock', async () => {
		const w = await step();
		await pick(w, 'midday', '2000-01-01T31:99:00');

		expect(lastSaved()!.midday).toBe('13:00');
	});

	it('falls back to the slot default when the picker clears the value', async () => {
		const w = await step();
		await pick(w, 'evening', '');

		expect(lastSaved()!.evening).toBe('18:30');
	});
});

describe('the notification permission', () => {
	// only a native build can schedule anything, so the web run must not claim they are off
	it('says nothing on a build that cannot schedule', async () => {
		const w = await step();

		expect(requireNotifications).not.toHaveBeenCalled();
		expect(w.text()).not.toContain('Notifications Off');
	});

	it('asks once on the native build', async () => {
		isNative.mockReturnValue(true);
		await step();

		expect(requireNotifications).toHaveBeenCalledTimes(1);
		expect(requireNotifications).toHaveBeenCalledWith('notifications');
	});

	it('explains the miss when the device refuses', async () => {
		isNative.mockReturnValue(true);
		requireNotifications.mockResolvedValue(false);
		const w = await step();

		expect(w.text()).toContain('Notifications Off');
	});

	it('stays quiet when the device agrees', async () => {
		isNative.mockReturnValue(true);
		const w = await step();

		expect(w.text()).not.toContain('Notifications Off');
	});

	// the times are still worth setting, so a refusal never removes the pickers
	it('still offers all three times after a refusal', async () => {
		isNative.mockReturnValue(true);
		requireNotifications.mockResolvedValue(false);
		const w = await step();

		expect(shown(w, 'morning')).toBe('2000-01-01T08:30:00');
		expect(shown(w, 'evening')).toBe('2000-01-01T18:30:00');
	});
});
