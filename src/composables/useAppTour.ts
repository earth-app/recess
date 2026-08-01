/**
 * The first-run tour.
 *
 * Onboarding explains what Recess is; it does not explain how the deck works, and the
 * deck's swipe gestures are invisible affordances - nothing on screen says that a swipe
 * counts. That was the reported gap: people did not know swiping resolved anything.
 *
 * `useAppTour`, not `useTour`: Nuxt UI 4 ships its own `useTour` and wins the
 * auto-import. Its `UTour` teleports into `<UApp>`, which this app never mounts, so it
 * could not work here even if the name were free.
 *
 * Kept deliberately small. sky's tour started at 22 cross-app auto-navigating steps and
 * had to be cut to 6 in-place ones, because the fragility was all in the navigation:
 * unawaited pushes, duplicate ids, no route guard. These steps never navigate.
 */
export const TOUR_KEY = 'recess.tour.v1';

/** bumped when the steps change enough that a finished user should see it again */
export const TOUR_VERSION = 1;

export interface AppTourStep {
	id: string;
	/** css selector for the element to spotlight; null centres the card with no cutout */
	target: string | null;
	titleKey: string;
	bodyKey: string;
	/** renders the animated swipe demonstration instead of a plain body */
	demo?: 'swipe';
	/** where to put the card relative to the cutout */
	placement?: 'above' | 'below';
}

export const TOUR_STEPS: readonly AppTourStep[] = [
	{
		id: 'deck',
		target: '[data-tour="deck"]',
		titleKey: 'tour.deckTitle',
		bodyKey: 'tour.deckBody',
		demo: 'swipe',
		placement: 'below'
	},
	{
		id: 'ring',
		target: '[data-tour="ring"]',
		titleKey: 'tour.ringTitle',
		bodyKey: 'tour.ringBody',
		placement: 'below'
	},
	{
		id: 'list',
		target: '[data-tour="list"]',
		titleKey: 'tour.listTitle',
		bodyKey: 'tour.listBody',
		placement: 'above'
	},
	{
		id: 'playground',
		target: '#tab-button-playground',
		titleKey: 'tour.playgroundTitle',
		bodyKey: 'tour.playgroundBody',
		placement: 'above'
	},
	{
		id: 'week',
		target: '#tab-button-week',
		titleKey: 'tour.weekTitle',
		bodyKey: 'tour.weekBody',
		placement: 'above'
	}
];

export interface AppTourState {
	/** the version the user last finished, so a rewritten tour can run again */
	completedVersion: number;
	/** where they were when they left, so a mid-tour close resumes rather than restarts */
	step: number;
}

export const TOUR_DEFAULTS: AppTourState = { completedVersion: 0, step: 0 };

export function parseTour(raw: unknown): AppTourState {
	if (!raw || typeof raw !== 'object') return { ...TOUR_DEFAULTS };
	const source = raw as Partial<AppTourState>;

	const step =
		typeof source.step === 'number' && source.step >= 0
			? Math.min(Math.floor(source.step), TOUR_STEPS.length - 1)
			: 0;

	return {
		completedVersion:
			typeof source.completedVersion === 'number' && source.completedVersion >= 0
				? Math.floor(source.completedVersion)
				: 0,
		step
	};
}

export function hasSeenTour(state: AppTourState, version = TOUR_VERSION): boolean {
	return state.completedVersion >= version;
}

export function useAppTour() {
	const state = useState<AppTourState>('recess-tour', () => ({ ...TOUR_DEFAULTS }));
	const ready = useState<boolean>('recess-tour-ready', () => false);
	const active = useState<boolean>('recess-tour-active', () => false);
	const { get, set } = useSettings();

	const step = computed(() => Math.min(state.value.step, TOUR_STEPS.length - 1));
	const current = computed<AppTourStep | null>(() => TOUR_STEPS[step.value] ?? null);
	const isLast = computed(() => step.value >= TOUR_STEPS.length - 1);
	const seen = computed(() => hasSeenTour(state.value));

	async function load() {
		if (ready.value) return state.value;
		state.value = parseTour(await get<unknown>(TOUR_KEY, null));
		ready.value = true;
		return state.value;
	}

	async function persist() {
		await set(TOUR_KEY, state.value);
	}

	/**
	 * Starts only when it has never been finished; safe to call on every mount.
	 *
	 * Reads through to storage rather than trusting `state`, because the `ready` guard in
	 * `load()` makes an early caller's result stick - and showing the tour again to
	 * someone who already finished it is the one failure worth ruling out.
	 */
	async function startIfUnseen() {
		const fresh = parseTour(await get<unknown>(TOUR_KEY, null));
		state.value = fresh;
		ready.value = true;

		if (hasSeenTour(fresh) || active.value) return false;
		active.value = true;
		return true;
	}

	function start() {
		state.value = { ...state.value, step: 0 };
		active.value = true;
	}

	async function goTo(index: number) {
		state.value = {
			...state.value,
			step: Math.min(Math.max(0, index), TOUR_STEPS.length - 1)
		};
		await persist();
	}

	async function next() {
		if (isLast.value) return finish();
		return goTo(step.value + 1);
	}

	async function back() {
		return goTo(step.value - 1);
	}

	/** both "Done" and "Skip" land here; a half-seen tour should not nag again */
	async function finish() {
		active.value = false;
		state.value = { completedVersion: TOUR_VERSION, step: 0 };
		await persist();
	}

	/** replay from Settings; clears the completion so `startIfUnseen` would run too */
	async function replay() {
		state.value = { completedVersion: 0, step: 0 };
		await persist();
		active.value = true;
	}

	return {
		state,
		ready,
		active,
		steps: TOUR_STEPS,
		step,
		current,
		isLast,
		seen,
		load,
		start,
		startIfUnseen,
		goTo,
		next,
		back,
		finish,
		replay
	};
}
