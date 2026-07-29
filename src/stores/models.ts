import { defineStore } from 'pinia';
import {
	emptyPackState,
	type Benchmark,
	type DeviceTier,
	type PackProgress,
	type PackStates
} from '~/types/models';
import { MODEL_PACKS, type ModelPack } from '~/types/nudge';
import { tierFromBenchmark } from '~/utils/tiers';

export const MODELS_KEY = 'recess.models.v1';

function emptyPacks(): PackStates {
	return MODEL_PACKS.reduce((acc, pack) => {
		acc[pack] = emptyPackState();
		return acc;
	}, {} as PackStates);
}

interface PersistedModels {
	benchmark: Benchmark | null;
	packs: PackStates;
}

export function parseModels(raw: unknown): PersistedModels {
	const packs = emptyPacks();
	if (!raw || typeof raw !== 'object') return { benchmark: null, packs };

	const source = raw as Partial<PersistedModels>;

	if (source.packs && typeof source.packs === 'object') {
		for (const pack of MODEL_PACKS) {
			const entry = (source.packs as Record<string, unknown>)[pack];
			if (!entry || typeof entry !== 'object') continue;
			const value = entry as Record<string, unknown>;
			packs[pack] = {
				installed: value.installed === true,
				bytes: typeof value.bytes === 'number' && value.bytes >= 0 ? value.bytes : 0,
				installedAt: typeof value.installedAt === 'number' ? value.installedAt : null,
				repo: typeof value.repo === 'string' ? value.repo : null,
				revision: typeof value.revision === 'string' ? value.revision : null
			};
		}
	}

	const b = source.benchmark;
	const benchmark =
		b && typeof b === 'object' && typeof b.matmulMs === 'number'
			? {
					webgpu: b.webgpu === true,
					cores: typeof b.cores === 'number' ? b.cores : 4,
					memoryGb: typeof b.memoryGb === 'number' ? b.memoryGb : 0,
					matmulMs: b.matmulMs,
					inferenceMs: typeof b.inferenceMs === 'number' ? b.inferenceMs : null,
					tier: ([1, 2, 3] as const).includes(b.tier as DeviceTier) ? (b.tier as DeviceTier) : 1,
					at: typeof b.at === 'number' ? b.at : 0
				}
			: null;

	return { benchmark, packs };
}

export const useModelsStore = defineStore('models', () => {
	const benchmark = ref<Benchmark | null>(null);
	const packs = ref<PackStates>(emptyPacks());
	const progress = ref<PackProgress | null>(null);
	const busy = ref<ModelPack | null>(null);
	const ready = ref(false);

	const detectedTier = computed<DeviceTier>(() => benchmark.value?.tier ?? 1);

	const tier = computed<DeviceTier>(() => {
		const override = useAppSettingsState().value.tierOverride;
		return override === null ? detectedTier.value : (override as DeviceTier);
	});

	const installed = computed<ModelPack[]>(() =>
		MODEL_PACKS.filter((pack) => packs.value[pack].installed)
	);

	const totalBytes = computed(() =>
		MODEL_PACKS.reduce((sum, pack) => sum + packs.value[pack].bytes, 0)
	);

	function has(pack: ModelPack): boolean {
		return packs.value[pack].installed;
	}

	async function load() {
		if (ready.value) return;
		const { get } = useSettings();
		await configurePreferencesGroup();

		const parsed = parseModels(await get<unknown>(MODELS_KEY, null));
		benchmark.value = parsed.benchmark;
		packs.value = parsed.packs;
		ready.value = true;
	}

	async function persist() {
		const { set } = useSettings();
		await set(MODELS_KEY, {
			benchmark: benchmark.value,
			packs: packs.value
		} satisfies PersistedModels);
	}

	async function setBenchmark(result: Omit<Benchmark, 'tier' | 'at'>) {
		const value: Benchmark = { ...result, tier: tierFromBenchmark(result), at: Date.now() };
		benchmark.value = value;
		await persist();
		return value;
	}

	async function markInstalled(
		pack: ModelPack,
		info: { bytes: number; repo: string; revision?: string }
	) {
		packs.value = {
			...packs.value,
			[pack]: {
				installed: true,
				bytes: Math.max(0, Math.round(info.bytes)),
				installedAt: Date.now(),
				repo: info.repo,
				revision: info.revision ?? null
			}
		};
		await persist();
	}

	async function markRemoved(pack: ModelPack) {
		packs.value = { ...packs.value, [pack]: emptyPackState() };
		await persist();
	}

	function setProgress(next: PackProgress | null) {
		progress.value = next;
	}

	return {
		benchmark,
		packs,
		progress,
		busy,
		ready,
		tier,
		detectedTier,
		installed,
		totalBytes,
		has,
		load,
		persist,
		setBenchmark,
		markInstalled,
		markRemoved,
		setProgress
	};
});
