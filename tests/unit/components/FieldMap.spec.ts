import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import FieldMap from '~/components/place/FieldMap.vue';
import type { NearbyPlace } from '~/utils/places';

/**
 * The map with no basemap.
 *
 * happy-dom has no canvas, so nothing this component *paints* is observable here - that is left
 * to e2e. What is testable is the part that actually matters for correctness and access: the
 * text alternative. A canvas is opaque to a screen reader, so the component owes WCAG 1.1.1 a
 * real description of every place it drew, not a label saying "map". These cases pin that the
 * alternative exists, that it survives an empty result, and that it names direction and distance
 * rather than leaving them visual-only.
 */

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof FieldMap>>>;

function place(id: string, overrides: Partial<NearbyPlace> = {}, name?: string): NearbyPlace {
	return {
		place: { id, lat: 41.88, lon: -87.63, a: ['sit'], ...(name ? { n: name } : {}) },
		metres: 240,
		bearing: 0,
		compass: 'n',
		minutes: 2.9,
		...overrides
	};
}

async function mount(props: Partial<InstanceType<typeof FieldMap>['$props']> = {}) {
	return mountSuspended(FieldMap, {
		props: { places: [], radius: 1680, ...props }
	}) as Promise<Wrapper>;
}

describe('FieldMap', () => {
	it('exposes the canvas as an image with a text alternative', async () => {
		const wrapper = await mount({ places: [place('a', {}, 'A Bench')] });
		const canvas = wrapper.find('canvas');

		expect(canvas.exists()).toBe(true);
		expect(canvas.attributes('role')).toBe('img');
		expect(canvas.attributes('aria-label')).toBeTruthy();
	});

	it('names each place with its distance and its direction', async () => {
		const wrapper = await mount({
			places: [place('a', { metres: 240, compass: 'ne' }, 'A Bench')]
		});

		const label = wrapper.find('canvas').attributes('aria-label') ?? '';
		expect(label).toContain('A Bench');
		expect(label).toContain('240');
		expect(label).toContain('north-east');
	});

	// the count is a plural message, and the singular branch is the one that renders wrong
	it('counts one place in the singular', async () => {
		const wrapper = await mount({ places: [place('a')] });
		expect(wrapper.find('canvas').attributes('aria-label')).toContain('1 place');
	});

	it('counts several in the plural', async () => {
		const wrapper = await mount({
			places: [place('a'), place('b'), place('c')]
		});
		expect(wrapper.find('canvas').attributes('aria-label')).toContain('3 places');
	});

	it('says what is true when nothing is in range, rather than describing an empty circle', async () => {
		const wrapper = await mount({ places: [], radius: 840 });
		const label = wrapper.find('canvas').attributes('aria-label') ?? '';

		expect(label).toMatch(/Nothing within/i);
		expect(label).toContain('10');
	});

	it('falls back to a real word when OSM has no name for a place', async () => {
		const wrapper = await mount({ places: [place('a')] });
		// never an empty gap or the raw id
		expect(wrapper.find('canvas').attributes('aria-label')).not.toContain('a,');
		expect(wrapper.find('canvas').attributes('aria-label')).toContain('Unnamed');
	});

	/**
	 * The list mirrors the canvas for anything that cannot read a picture. It is `sr-only` rather
	 * than hidden, because `aria-hidden` or `display:none` would take it out of the tree that
	 * needs it.
	 */
	it('mirrors every place into a screen-reader list', async () => {
		const wrapper = await mount({
			places: [place('a', {}, 'A Bench'), place('b', { compass: 's' }, 'A Fountain')]
		});

		const list = wrapper.find('ul');
		expect(list.classes()).toContain('sr-only');
		expect(list.findAll('li')).toHaveLength(2);
		expect(list.text()).toContain('A Bench');
		expect(list.text()).toContain('A Fountain');
	});

	it('does not truncate the list even though the label summarises', async () => {
		const many = Array.from({ length: 20 }, (_, index) => place(`p${index}`, {}, `Place ${index}`));
		const wrapper = await mount({ places: many });

		expect(wrapper.findAll('li')).toHaveLength(20);
	});

	it('emits the place that was tapped', async () => {
		const wrapper = await mount({ places: [place('a', { metres: 0, bearing: 0 }, 'A Bench')] });

		// happy-dom gives the canvas a zero-size box, so a tap at the origin is the centre
		vi.spyOn(wrapper.find('canvas').element, 'getBoundingClientRect').mockReturnValue({
			left: 0,
			top: 0,
			width: 300,
			height: 300,
			right: 300,
			bottom: 300,
			x: 0,
			y: 0,
			toJSON: () => ({})
		} as DOMRect);

		await wrapper.find('canvas').trigger('click', { clientX: 150, clientY: 150 });
		expect(wrapper.emitted('select')?.[0]).toEqual(['a']);
	});

	it('emits nothing when the tap lands away from every place', async () => {
		const wrapper = await mount({ places: [place('a', { metres: 0 })] });

		vi.spyOn(wrapper.find('canvas').element, 'getBoundingClientRect').mockReturnValue({
			left: 0,
			top: 0,
			width: 300,
			height: 300,
			right: 300,
			bottom: 300,
			x: 0,
			y: 0,
			toJSON: () => ({})
		} as DOMRect);

		await wrapper.find('canvas').trigger('click', { clientX: 4, clientY: 4 });
		expect(wrapper.emitted('select')).toBeUndefined();
	});

	it('mounts without a canvas context rather than throwing', async () => {
		// happy-dom returns null from getContext; the component must survive that
		const wrapper = await mount({ places: [place('a')] });
		expect(wrapper.find('canvas').exists()).toBe(true);
	});
});
