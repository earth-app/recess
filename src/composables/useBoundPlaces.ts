import { bindPlaces, visitedCells, type PlaceBinding } from '~/utils/places';

export function useBoundPlaces() {
	const bindings = computed<PlaceBinding[]>(() => {
		// every read is guarded: this runs on every resolution, including before the stores
		// have loaded, and a binding is always optional
		const deck = useNudgesStore().today ?? [];
		if (deck.length === 0) return [];

		const { pack } = useAreas();
		const { snapshot: position } = usePosition();
		if (!pack.value || !position.value) return [];

		return bindPlaces(
			deck,
			pack.value,
			{ latitude: position.value.latitude, longitude: position.value.longitude },
			// cells the user resolved something in; the only location history recess keeps
			{ visited: visitedCells(useProgressStore().entries ?? []) }
		);
	});

	const byNudge = computed(() => new Map(bindings.value.map((entry) => [entry.nudgeId, entry])));

	function bindingFor(nudgeId: string): PlaceBinding | null {
		return byNudge.value.get(nudgeId) ?? null;
	}

	/** the cell to stamp on a ledger entry, or undefined when the nudge was not bound */
	function placeFor(nudgeId: string): { lat: number; lon: number } | undefined {
		const binding = byNudge.value.get(nudgeId);
		if (!binding) return undefined;
		return { lat: binding.place.place.lat, lon: binding.place.place.lon };
	}

	return { bindings, bindingFor, placeFor };
}
