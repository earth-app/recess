import type { NudgeCategory } from '~/types/nudge';

// Onboarding seeds the recommender rather than gating the app. Every step is
// skippable and the whole thing is resumable, so a half-finished run on a bus is
// not a dead end.

export const ONBOARDING_KEY = 'recess.onboarding.v1';

export const ONBOARDING_STEPS = [
	'intro_small',
	'intro_finite',
	'intro_private',
	'interests',
	'times',
	'models'
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** the first three are pure slides; the rest actually set something */
export const SLIDE_STEPS: readonly OnboardingStep[] = [
	'intro_small',
	'intro_finite',
	'intro_private'
];

export interface OnboardingState {
	completed: boolean;
	/** furthest step reached, so a resume lands where they left off */
	step: number;
	skippedModels: boolean;
	completedAt: number | null;
}

export const ONBOARDING_DEFAULTS: OnboardingState = {
	completed: false,
	step: 0,
	skippedModels: false,
	completedAt: null
};

export function parseOnboarding(raw: unknown): OnboardingState {
	if (!raw || typeof raw !== 'object') return { ...ONBOARDING_DEFAULTS };
	const source = raw as Partial<OnboardingState>;

	return {
		completed: source.completed === true,
		step:
			typeof source.step === 'number' && source.step >= 0
				? Math.min(ONBOARDING_STEPS.length - 1, Math.floor(source.step))
				: 0,
		skippedModels: source.skippedModels === true,
		completedAt: typeof source.completedAt === 'number' ? source.completedAt : null
	};
}

export function useOnboarding() {
	const state = useState<OnboardingState>('recess-onboarding', () => ({ ...ONBOARDING_DEFAULTS }));
	const ready = useState<boolean>('recess-onboarding-ready', () => false);
	const { get, set, remove } = useSettings();
	const { setValue } = useAppSettings();

	async function load(): Promise<OnboardingState> {
		if (ready.value) return state.value;
		await configurePreferencesGroup();
		state.value = parseOnboarding(await get<unknown>(ONBOARDING_KEY, null));
		ready.value = true;
		return state.value;
	}

	async function persist() {
		await set(ONBOARDING_KEY, state.value);
	}

	const step = computed(() => ONBOARDING_STEPS[state.value.step] ?? 'intro_small');
	const isLast = computed(() => state.value.step >= ONBOARDING_STEPS.length - 1);
	const progress = computed(() => (state.value.step + 1) / ONBOARDING_STEPS.length);

	async function goTo(index: number) {
		state.value = {
			...state.value,
			step: Math.min(ONBOARDING_STEPS.length - 1, Math.max(0, index))
		};
		await persist();
	}

	async function next() {
		if (isLast.value) return finish();
		return goTo(state.value.step + 1);
	}

	async function back() {
		return goTo(state.value.step - 1);
	}

	async function setInterests(categories: NudgeCategory[]) {
		await setValue('interests', categories);
	}

	async function setTimes(times: { morning: string; midday: string; evening: string }) {
		await setValue('morningTime', times.morning);
		await setValue('middayTime', times.midday);
		await setValue('eveningTime', times.evening);
	}

	async function skipModels() {
		state.value = { ...state.value, skippedModels: true };
		await persist();
	}

	async function finish() {
		state.value = { ...state.value, completed: true, completedAt: Date.now() };
		await persist();
	}

	/** dev affordance, and the Settings "Replay Onboarding" action */
	async function reset() {
		state.value = { ...ONBOARDING_DEFAULTS };
		await remove(ONBOARDING_KEY);
		ready.value = true;
	}

	return {
		state,
		ready,
		step,
		steps: ONBOARDING_STEPS,
		isLast,
		progress,
		load,
		goTo,
		next,
		back,
		setInterests,
		setTimes,
		skipModels,
		finish,
		reset
	};
}
