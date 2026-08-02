import { z } from 'zod';

// #region vocabulary

/**
 * What you can DO somewhere, not what it is called.
 *
 * A business category ("cafe", "library") answers a question nobody asked here; a nudge wants
 * somewhere to sit, somewhere quiet, somewhere with a long view. Every token below is backed by
 * OSM tags that are genuinely populated - the counts were measured against taginfo rather than
 * assumed, and two candidates were dropped outright because they do not exist in practice:
 * `amenity=noticeboard` and `man_made=board` have **two objects each worldwide**.
 */
export const AFFORDANCES = [
	'sit',
	'green',
	'water',
	'drink',
	'quiet',
	'view',
	'shelter',
	'people',
	'art',
	'read',
	'move',
	'grow',
	'food',
	'old'
] as const;

export type Affordance = (typeof AFFORDANCES)[number];

/**
 * OSM `key=value` to the affordances it implies. One tag may imply several.
 *
 * The global object count for each tag is in the trailing comment, measured 2026-07-31 via
 * taginfo. Anything under ~10k worldwide is not worth a token: it would produce a filter that
 * passes almost nowhere, which reads to the user as the feature being broken rather than as the
 * data being thin.
 *
 * Deliberately absent: `natural=tree` (34M) and `highway=footway` (32M). Both are enormous and
 * neither is a destination - a single street tree is not somewhere you go, and a footway is a
 * line, not a place. `green` is carried by parks and woods instead.
 */
export const TAG_AFFORDANCES: Record<string, readonly Affordance[]> = {
	// sitting and shelter
	'amenity=bench': ['sit'], // 3,329,850
	'amenity=shelter': ['sit', 'shelter'], // 674,106
	'tourism=picnic_site': ['sit', 'green', 'people'], // 167,625

	// green
	'leisure=park': ['green', 'sit', 'people'], // 1,293,161
	'leisure=garden': ['green', 'quiet'], // 1,549,108
	'natural=wood': ['green', 'quiet'], // 12,550,690
	'leisure=nature_reserve': ['green', 'quiet'], // 149,451
	'leisure=common': ['green', 'people'], // 30,859
	'leisure=dog_park': ['green', 'people'], // 29,922

	// water
	'natural=water': ['water', 'view'], // 23,040,130
	'natural=beach': ['water', 'view', 'sit'], // 247,839
	'amenity=fountain': ['water'], // 200,082
	'amenity=drinking_water': ['drink'], // 362,203
	'amenity=water_point': ['drink'], // 42,443

	// long views and high ground
	'tourism=viewpoint': ['view'], // 260,446
	'natural=peak': ['view'], // 1,096,732

	// quiet, indoors
	'amenity=library': ['quiet', 'read', 'shelter'], // 112,634
	'amenity=place_of_worship': ['quiet', 'old', 'shelter'], // 1,612,634
	'tourism=museum': ['quiet', 'old', 'art', 'shelter'], // 110,519

	// other people
	'amenity=cafe': ['people', 'shelter'], // 642,698
	'amenity=community_centre': ['people', 'shelter'], // 217,688
	'amenity=marketplace': ['people', 'food'], // 97,854
	'leisure=playground': ['people', 'move'], // 1,001,521

	// making and looking
	'tourism=artwork': ['art'], // 362,455
	'historic=memorial': ['art', 'old'], // 500,957
	'historic=monument': ['art', 'old'], // 71,618

	// reading
	'amenity=public_bookcase': ['read'], // 45,871
	'shop=books': ['read', 'shelter'], // 57,995

	// moving
	'leisure=fitness_station': ['move'], // 99,525
	'leisure=pitch': ['move'], // 2,821,622

	// growing and food
	'landuse=allotments': ['grow', 'green'], // 483,208
	'shop=bakery': ['food'], // 253,097
	'shop=greengrocer': ['food'] // 66,280
};

/** the minimum global object count a tag needs before it earns a place in the table above */
export const TAG_COUNT_FLOOR = 10_000;

/** colour token per affordance, from colors.json; shared by the field map and the list */
export const AFFORDANCE_COLORS: Record<Affordance, string> = {
	sit: '@brown',
	green: '@green',
	water: '@teal',
	drink: '@blue',
	quiet: '@indigo',
	view: '@purple',
	shelter: '@gray',
	people: '@coral',
	art: '@pink',
	read: '@gold',
	move: '@lime',
	grow: '@lime',
	food: '@orange',
	old: '@brown'
};

/** a glyph per affordance, so the map is not colour-only */
export const AFFORDANCE_ICONS: Record<Affordance, string> = {
	sit: 'mdi:bench',
	green: 'mdi:tree',
	water: 'mdi:waves',
	drink: 'mdi:water',
	quiet: 'mdi:volume-off',
	view: 'mdi:binoculars',
	shelter: 'mdi:home-roof',
	people: 'mdi:account-group',
	art: 'mdi:palette',
	read: 'mdi:book-open-variant',
	move: 'mdi:run',
	grow: 'mdi:sprout',
	food: 'mdi:bread-slice',
	old: 'mdi:pillar'
};

// #endregion

// #region pack format

/**
 * One place, as it lives in a downloaded area pack.
 *
 * Kept deliberately narrow. Coordinates are pre-snapped to the privacy grid at build time, so a
 * pack cannot leak finer resolution than the app is willing to use, and `name` is omitted rather
 * than invented when OSM has none.
 */
export const placeSchema = z.object({
	id: z.string().min(1),
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
	a: z.array(z.enum(AFFORDANCES)).min(1),
	n: z.string().min(1).optional()
});

export type PackedPlace = z.infer<typeof placeSchema>;

export const areaPackSchema = z.object({
	/** bumped when the pack layout changes in a way an older client cannot read */
	version: z.literal(1),
	/** stable slug, e.g. `us-il-chicago` */
	id: z.string().min(1),
	label: z.string().min(1),
	/** [west, south, east, north] */
	bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
	/** epoch ms of the OSM extract the pack was cut from */
	built_at: z.number(),
	/** ODbL requires naming the source; carried in the pack so it cannot drift from the data */
	attribution: z.string().min(1),
	places: z.array(placeSchema)
});

export type AreaPack = z.infer<typeof areaPackSchema>;

/**
 * What the query helpers actually need.
 *
 * The loaded pack is exposed through `readonly()`, so it arrives deep-readonly and will not
 * satisfy `AreaPack`. Accepting the narrower readonly shape is more honest than casting it away -
 * none of the query helpers mutate, and `AreaPack` satisfies this structurally.
 */
export interface ReadonlyPlace {
	readonly id: string;
	readonly lat: number;
	readonly lon: number;
	readonly a: readonly Affordance[];
	readonly n?: string;
}

export interface ReadonlyPack {
	readonly places: readonly ReadonlyPlace[];
}

export const areaManifestEntrySchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
	/**
	 * Uncompressed size of the pack file, measured off the file that will be served.
	 *
	 * Deliberately the raw size rather than the gzipped one: whether the CDN negotiates
	 * compression is not something the app can know, so the raw figure is true either way and can
	 * only ever overstate the transfer. It is also exactly what lands on disk. Never an estimate -
	 * `scripts/build-area-manifest.ts` reads it off the file.
	 */
	bytes: z.number().nonnegative(),
	places: z.number().nonnegative(),
	built_at: z.number()
});

export type AreaManifestEntry = z.infer<typeof areaManifestEntrySchema>;

export const areaManifestSchema = z.object({
	version: z.literal(1),
	areas: z.array(areaManifestEntrySchema)
});

export type AreaManifest = z.infer<typeof areaManifestSchema>;

// #endregion
