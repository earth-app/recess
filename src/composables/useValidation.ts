import type { Nudge } from '~/types/nudge';
import { isValidated, nudgeRequiredPack } from '~/types/nudge';
import { devVerdict } from '~/utils/dev';
import { checkFreshCapture, readExif } from '~/utils/exif';
import { clipLogits, embedTexts, transcribe } from '~/utils/ml';
import {
	validateSubmission,
	type Submission,
	type ValidationScorers,
	type Verdict
} from '~/utils/validate';

// Rotating status strings so a slow inference reads as work rather than a hang.
// Same pattern as crust's quest Submission.vue.
export const STATUS_INTERVAL_MS = 1800;

const STATUS_MESSAGES: Record<string, string[]> = {
	photo: ['Looking at your photo', 'Finding the edges', 'Comparing what we see', 'Almost there'],
	text: ['Reading what you wrote', 'Weighing it up', 'Thinking about it', 'Almost there'],
	audio: ['Listening back', 'Making out the words', 'Weighing it up', 'Almost there'],
	barcode: ['Reading the code', 'Checking the digits', 'Almost there'],
	count: ['Checking that number'],
	confirm: ['Marking it done']
};

export function statusMessagesFor(kind: string): string[] {
	return STATUS_MESSAGES[kind] ?? ['Checking'];
}

export function useValidation() {
	const models = useModelsStore();
	const settings = useAppSettingsState();
	const { warm } = useModels();
	const { benchmark } = useCapability();

	const validating = ref(false);
	const status = ref<string | null>(null);
	const verdict = ref<Verdict | null>(null);
	/** true while a cold model is loading, which is materially slower than a warm one */
	const warming = ref(false);

	let statusTimer: ReturnType<typeof setInterval> | null = null;

	function startStatus(kind: string) {
		const messages = statusMessagesFor(kind);
		let index = 0;
		status.value = messages[0] ?? null;
		statusTimer = setInterval(() => {
			index = (index + 1) % messages.length;
			status.value = messages[index] ?? null;
		}, STATUS_INTERVAL_MS);
	}

	function stopStatus() {
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = null;
		status.value = null;
	}

	function scorers(): ValidationScorers {
		const options = {
			tier: models.tier,
			locale: settings.value.locale,
			webgpu: benchmark.value?.webgpu ?? false,
			allowRemote: false
		};

		return {
			embed: models.has('text')
				? async (texts) =>
						(await embedTexts(texts, options)) ?? Promise.reject(new Error('embed failed'))
				: undefined,
			clipLogits: models.has('vision')
				? async (image, labels) =>
						(await clipLogits(image, labels, options)) ?? Promise.reject(new Error('clip failed'))
				: undefined,
			transcribe: models.has('audio')
				? async (audio) =>
						(await transcribe(audio, options)) ?? Promise.reject(new Error('transcribe failed'))
				: undefined
		};
	}

	/**
	 * validate one submission. never returns `passed` on an error path - a failure
	 * becomes `unavailable`, which the UI turns into an explicit self-attest offer.
	 */
	async function run(nudge: Nudge, submission: Submission): Promise<Verdict> {
		validating.value = true;
		verdict.value = null;
		startStatus(submission.kind);

		try {
			const forced = devVerdict();
			if (forced !== null) {
				const result: Verdict =
					forced === 'unavailable'
						? { status: 'unavailable', reason: 'dev override' }
						: { status: forced, detail: 'Forced by the developer panel' };
				verdict.value = result;
				return result;
			}

			/**
			 * A fresh-capture requirement is deterministic, so it is checked before any model.
			 *
			 * Narrowed through `isValidated`, not cast. This read used to be
			 * `(nudge as { validation_data?: { require_fresh_exif?: boolean } })`, a shape written
			 * by hand rather than derived from `photoValidationSchema` - so renaming that field
			 * would have made this expression `undefined` forever, silently turning EXIF forensics
			 * off for all 19 nudges that ask for it while typecheck and the whole unit suite stayed
			 * green. A fail-open in the one place the app is required to fail closed.
			 */
			if (submission.kind === 'photo' && isValidated(nudge) && nudge.validation_type === 'photo') {
				const data = nudge.validation_data;
				if (data.require_fresh_exif) {
					const check = checkFreshCapture(await readExif(submission.image), Date.now());
					if (!check.ok) {
						const result: Verdict = { status: 'missed', detail: check.reason };
						verdict.value = result;
						return result;
					}
				}
			}

			const pack = nudgeRequiredPack(nudge);
			if (pack && models.has(pack)) {
				warming.value = true;
				try {
					await warm(pack);
				} finally {
					warming.value = false;
				}
			}

			const result = await validateSubmission(nudge, submission, { scorers: scorers() });
			verdict.value = result;
			return result;
		} finally {
			stopStatus();
			validating.value = false;
		}
	}

	function reset() {
		stopStatus();
		verdict.value = null;
		validating.value = false;
		warming.value = false;
	}

	onScopeDispose(() => stopStatus());

	return {
		validating: readonly(validating),
		warming: readonly(warming),
		status: readonly(status),
		verdict: readonly(verdict),
		run,
		reset,
		statusMessagesFor
	};
}
