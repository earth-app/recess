import { z } from 'zod';

// #region vocabularies

export const NUDGE_CATEGORIES = [
	'people',
	'adventure',
	'home',
	'learn',
	'cooking',
	'nature',
	'errands',
	'exercise',
	'art'
] as const;
export type NudgeCategory = (typeof NUDGE_CATEGORIES)[number];

export const NUDGE_TYPES = [
	'task',
	'question',
	'think',
	'choose',
	'create',
	'notice',
	'count'
] as const;
export type NudgeType = (typeof NUDGE_TYPES)[number];

export const VALIDATION_TYPES = ['confirm', 'text', 'photo', 'audio', 'barcode', 'count'] as const;
export type ValidationType = (typeof VALIDATION_TYPES)[number];

export const MODEL_PACKS = ['vision', 'text', 'audio', 'writing'] as const;
export type ModelPack = (typeof MODEL_PACKS)[number];

export const PERMISSIONS = ['camera', 'microphone', 'location', 'notifications'] as const;
export type NudgePermission = (typeof PERMISSIONS)[number];

export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const MOON_PHASES = [
	'new',
	'waxing_crescent',
	'first_quarter',
	'waxing_gibbous',
	'full',
	'waning_gibbous',
	'last_quarter',
	'waning_crescent'
] as const;
export type MoonPhase = (typeof MOON_PHASES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WEEKDAY_GROUPS = ['weekday', 'weekend'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WeekdayToken = Weekday | (typeof WEEKDAY_GROUPS)[number];

/** every WMO 4677 code Open-Meteo actually reports, one stable name each */
export const WEATHER_CONDITIONS = [
	'clear',
	'mainly_clear',
	'partly_cloudy',
	'overcast',
	'fog',
	'rime_fog',
	'light_drizzle',
	'drizzle',
	'heavy_drizzle',
	'light_freezing_drizzle',
	'freezing_drizzle',
	'light_rain',
	'rain',
	'heavy_rain',
	'light_freezing_rain',
	'freezing_rain',
	'light_snow',
	'snow',
	'heavy_snow',
	'snow_grains',
	'light_showers',
	'showers',
	'heavy_showers',
	'light_snow_showers',
	'snow_showers',
	'thunderstorm',
	'thunderstorm_hail',
	'thunderstorm_heavy_hail'
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/**
 * convenience buckets so a nudge can say `any_precipitation` instead of listing
 * eighteen codes. the last five are derived from temperature/wind/humidity/uv
 * rather than the weather code itself.
 */
export const WEATHER_GROUPS = [
	'clear_ish',
	'cloudy_ish',
	'foggy',
	'any_drizzle',
	'any_rain',
	'any_snow',
	'any_showers',
	'any_freezing',
	'any_precipitation',
	'any_thunderstorm',
	'severe',
	'hot',
	'cold',
	'windy',
	'humid',
	'uv_high'
] as const;
export type WeatherGroup = (typeof WEATHER_GROUPS)[number];

export type WeatherToken = WeatherCondition | WeatherGroup;

// #endregion

// #region color

/** `@alias` from colors.json, or a literal hex / rgb() / rgba() */
export const colorTokenSchema = z
	.string()
	.regex(
		/^(@[a-z][a-z0-9_]*|#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/,
		'expected @alias, #hex, rgb(...) or rgba(...)'
	);

// #endregion

// #region filters

const enumFilterValue = <T extends string>(values: readonly [T, ...T[]]) =>
	z
		.object({
			is: z.array(z.enum(values)).min(1).optional(),
			is_not: z.array(z.enum(values)).min(1).optional()
		})
		.refine((v) => v.is !== undefined || v.is_not !== undefined, {
			message: 'enum filters need `is` or `is_not`'
		});

const comparisonKeys = {
	equals: z.number().optional(),
	greater_than: z.number().optional(),
	greater_than_or_eq: z.number().optional(),
	less_than: z.number().optional(),
	less_than_or_eq: z.number().optional(),
	between: z.tuple([z.number(), z.number()]).optional()
};

const numericFilterValue = z
	.object(comparisonKeys)
	.refine((v) => Object.values(v).some((entry) => entry !== undefined), {
		message: 'numeric filters need at least one comparison'
	});

const temperatureFilterValue = z
	.object({ ...comparisonKeys, unit: z.enum(['c', 'f']).default('c') })
	.refine(
		(v) =>
			v.equals !== undefined ||
			v.greater_than !== undefined ||
			v.greater_than_or_eq !== undefined ||
			v.less_than !== undefined ||
			v.less_than_or_eq !== undefined ||
			v.between !== undefined,
		{ message: 'numeric filters need at least one comparison' }
	);

export const nudgeFilterSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('time_of_day'), value: enumFilterValue(TIMES_OF_DAY) }),
	z.object({ type: z.literal('season'), value: enumFilterValue(SEASONS) }),
	z.object({
		type: z.literal('weekday'),
		value: enumFilterValue([...WEEKDAYS, ...WEEKDAY_GROUPS])
	}),
	z.object({
		type: z.literal('weather'),
		value: enumFilterValue([...WEATHER_CONDITIONS, ...WEATHER_GROUPS])
	}),
	z.object({ type: z.literal('moon_phase'), value: enumFilterValue(MOON_PHASES) }),
	z.object({ type: z.literal('permission'), value: enumFilterValue(PERMISSIONS) }),
	z.object({ type: z.literal('model_pack'), value: enumFilterValue(MODEL_PACKS) }),
	z.object({
		type: z.literal('locale'),
		value: z
			.object({
				is: z.array(z.string()).min(1).optional(),
				is_not: z.array(z.string()).min(1).optional()
			})
			.refine((v) => v.is !== undefined || v.is_not !== undefined, {
				message: 'enum filters need `is` or `is_not`'
			})
	}),
	z.object({
		type: z.literal('completed'),
		value: z
			.object({
				is: z.array(z.string()).min(1).optional(),
				is_not: z.array(z.string()).min(1).optional()
			})
			.refine((v) => v.is !== undefined || v.is_not !== undefined, {
				message: 'enum filters need `is` or `is_not`'
			})
	}),
	z.object({ type: z.literal('hour'), value: numericFilterValue }),
	z.object({ type: z.literal('temperature'), value: temperatureFilterValue }),
	z.object({ type: z.literal('wind_speed'), value: numericFilterValue }),
	z.object({ type: z.literal('humidity'), value: numericFilterValue }),
	z.object({ type: z.literal('uv_index'), value: numericFilterValue }),
	z.object({ type: z.literal('daylight_remaining'), value: numericFilterValue }),
	z.object({ type: z.literal('moon_illumination'), value: numericFilterValue }),
	z.object({ type: z.literal('points'), value: numericFilterValue }),
	z.object({ type: z.literal('streak_days'), value: numericFilterValue }),
	z.object({ type: z.literal('completed_today'), value: numericFilterValue }),
	z.object({ type: z.literal('days_since_completed'), value: numericFilterValue })
]);

export type NudgeFilter = z.infer<typeof nudgeFilterSchema>;
export type NudgeFilterType = NudgeFilter['type'];

export const ENUM_FILTER_TYPES = [
	'time_of_day',
	'season',
	'weekday',
	'weather',
	'moon_phase',
	'permission',
	'model_pack',
	'locale',
	'completed'
] as const satisfies readonly NudgeFilterType[];

export const NUMERIC_FILTER_TYPES = [
	'hour',
	'temperature',
	'wind_speed',
	'humidity',
	'uv_index',
	'daylight_remaining',
	'moon_illumination',
	'points',
	'streak_days',
	'completed_today',
	'days_since_completed'
] as const satisfies readonly NudgeFilterType[];

// #endregion

// #region validation

/**
 * mirrors cloud's ScoringCriterion. weights must sum to 1.0 - the scorer throws
 * otherwise rather than silently renormalizing, so a bad rubric fails loudly.
 */
export const scoringCriterionSchema = z
	.object({
		id: z.string().min(1),
		weight: z.number().gt(0).lte(1),
		ideal: z.string().min(1)
	})
	.strict();
export type ScoringCriterion = z.infer<typeof scoringCriterionSchema>;

const rubricSchema = z
	.array(scoringCriterionSchema)
	.min(1)
	.refine((rubric) => Math.abs(rubric.reduce((sum, c) => sum + c.weight, 0) - 1) <= 0.001, {
		message: 'rubric weights must sum to 1.0'
	});

/** 0-1 fraction or 0-100 percentage; normalizeThreshold collapses both */
const thresholdSchema = z.number().min(0).max(100);

export const TEXT_LENGTH_FLOOR = 50;
export const TEXT_LENGTH_CEILING = 2048;

export const textValidationSchema = z
	.object({
		rubric: rubricSchema,
		threshold: thresholdSchema,
		min_length: z.number().int().min(TEXT_LENGTH_FLOOR).max(TEXT_LENGTH_CEILING).optional(),
		max_length: z.number().int().min(TEXT_LENGTH_FLOOR).max(TEXT_LENGTH_CEILING).optional()
	})
	.strict();

export const photoValidationSchema = z
	.object({
		// always english - an internal CLIP prompt the user never sees
		labels: z.array(z.string().min(1)).min(1),
		negative_labels: z.array(z.string().min(1)).optional(),
		threshold: thresholdSchema,
		require_fresh_exif: z.boolean().optional()
	})
	.strict();

export const audioValidationSchema = z
	.object({
		rubric: rubricSchema,
		threshold: thresholdSchema,
		min_seconds: z.number().int().positive().max(300).optional()
	})
	.strict();

export const BARCODE_KINDS = ['retail', 'book', 'vehicle', 'boarding_pass'] as const;
export type BarcodeKind = (typeof BARCODE_KINDS)[number];

export const barcodeValidationSchema = z
	.object({
		kind: z.enum(BARCODE_KINDS),
		require_checksum: z.boolean().optional()
	})
	.strict();

export const countValidationSchema = z
	.object({
		min: z.number().int().min(0),
		max: z.number().int().min(0)
	})
	.strict()
	.refine((v) => v.max >= v.min, { message: 'count max must be >= min' });

export type TextValidationData = z.infer<typeof textValidationSchema>;
export type PhotoValidationData = z.infer<typeof photoValidationSchema>;
export type AudioValidationData = z.infer<typeof audioValidationSchema>;
export type BarcodeValidationData = z.infer<typeof barcodeValidationSchema>;
export type CountValidationData = z.infer<typeof countValidationSchema>;

/** the validation_type + validation_data pair, keyed so each shape is enforced */
export const validationSpecSchema = z.union([
	z.object({ validation_type: z.literal('confirm'), validation_data: z.undefined().optional() }),
	z.object({ validation_type: z.literal('text'), validation_data: textValidationSchema }),
	z.object({ validation_type: z.literal('photo'), validation_data: photoValidationSchema }),
	z.object({ validation_type: z.literal('audio'), validation_data: audioValidationSchema }),
	z.object({ validation_type: z.literal('barcode'), validation_data: barcodeValidationSchema }),
	z.object({ validation_type: z.literal('count'), validation_data: countValidationSchema })
]);

export type ValidationSpec = z.infer<typeof validationSpecSchema>;

/** which model pack a validation_type needs; confirm/barcode/count need none */
export const VALIDATION_PACK: Record<ValidationType, ModelPack | null> = {
	confirm: null,
	text: 'text',
	photo: 'vision',
	audio: 'audio',
	barcode: null,
	count: null
};

// #endregion

// #region authored nudges

const slugSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'slug must be lowercase words joined by underscores');

/** shared by every type; `type`/`category`/`locale` come from the file path */
const authoredBase = z.object({
	id: slugSchema,
	icon: z.string().min(1),
	color: colorTokenSchema,
	points: z.number().int().min(1).max(100),
	filters: z.array(nudgeFilterSchema).optional(),
	tags: z.array(z.string().min(1)).optional(),
	duration_minutes: z.number().int().min(1).max(240).optional(),
	locales: z.array(z.string().min(1)).min(1).optional()
});

const actionSchema = z
	.object({
		label: z.string().min(1),
		color: colorTokenSchema,
		icon: z.string().min(1).optional(),
		// chains into another nudge so "I'll do it now" is an if-then plan, not a dead end
		leads_to: z.string().min(1).optional()
	})
	.strict();
export type NudgeAction = z.infer<typeof actionSchema>;

const optionSchema = z
	.object({
		text: z.string().min(1),
		color: colorTokenSchema,
		icon: z.string().min(1).optional()
	})
	.strict();
export type NudgeOption = z.infer<typeof optionSchema>;

export const authoredTaskSchema = authoredBase
	.extend({
		title: z.string().min(1),
		description: z.string().min(1)
	})
	.and(validationSpecSchema);

export const authoredQuestionSchema = authoredBase.extend({
	question: z.string().min(1),
	actions: z.array(actionSchema).min(2).max(4)
});

export const authoredThinkSchema = authoredBase.extend({
	prompt: z.string().min(1)
});

export const authoredChooseSchema = authoredBase.extend({
	prompt: z.string().min(1),
	options: z.array(optionSchema).min(2).max(4)
});

export const authoredCreateSchema = authoredBase
	.extend({ prompt: z.string().min(1) })
	.and(z.object({ validation_type: z.literal('photo'), validation_data: photoValidationSchema }));

export const authoredNoticeSchema = authoredBase
	.extend({ prompt: z.string().min(1) })
	.and(
		z.union([
			z.object({ validation_type: z.literal('photo'), validation_data: photoValidationSchema }),
			z.object({ validation_type: z.literal('audio'), validation_data: audioValidationSchema })
		])
	);

export const authoredCountSchema = authoredBase
	.extend({
		prompt: z.string().min(1),
		unit: z.string().min(1)
	})
	.and(z.object({ validation_type: z.literal('count'), validation_data: countValidationSchema }));

export const AUTHORED_SCHEMAS = {
	task: authoredTaskSchema,
	question: authoredQuestionSchema,
	think: authoredThinkSchema,
	choose: authoredChooseSchema,
	create: authoredCreateSchema,
	notice: authoredNoticeSchema,
	count: authoredCountSchema
} as const satisfies Record<NudgeType, z.ZodType>;

// #endregion

// #region normalized nudges

interface NudgeCommon {
	/** composed global key: `<category>.<type>.<slug>` */
	id: string;
	slug: string;
	category: NudgeCategory;
	locale: string;
	icon: string;
	color: string;
	points: number;
	filters: NudgeFilter[];
	tags: string[];
	duration_minutes?: number;
	locales?: string[];
}

export type TaskNudge = NudgeCommon & {
	type: 'task';
	title: string;
	description: string;
} & ValidationSpec;
export type QuestionNudge = NudgeCommon & {
	type: 'question';
	question: string;
	actions: NudgeAction[];
};
export type ThinkNudge = NudgeCommon & { type: 'think'; prompt: string };
export type ChooseNudge = NudgeCommon & { type: 'choose'; prompt: string; options: NudgeOption[] };
export type CreateNudge = NudgeCommon & { type: 'create'; prompt: string } & {
	validation_type: 'photo';
	validation_data: PhotoValidationData;
};
export type NoticeNudge = NudgeCommon & { type: 'notice'; prompt: string } & (
		| { validation_type: 'photo'; validation_data: PhotoValidationData }
		| { validation_type: 'audio'; validation_data: AudioValidationData }
	);
export type CountNudge = NudgeCommon & { type: 'count'; prompt: string; unit: string } & {
	validation_type: 'count';
	validation_data: CountValidationData;
};

export type Nudge =
	TaskNudge | QuestionNudge | ThinkNudge | ChooseNudge | CreateNudge | NoticeNudge | CountNudge;

export type ValidatedNudge = TaskNudge | CreateNudge | NoticeNudge | CountNudge;

export function isValidated(nudge: Nudge): nudge is ValidatedNudge {
	return (
		nudge.type === 'task' ||
		nudge.type === 'create' ||
		nudge.type === 'notice' ||
		nudge.type === 'count'
	);
}

/** the headline string for a nudge, whichever field its type happens to use */
export function nudgeTitle(nudge: Nudge): string {
	switch (nudge.type) {
		case 'task':
			return nudge.title;
		case 'question':
			return nudge.question;
		default:
			return nudge.prompt;
	}
}

export function nudgeBody(nudge: Nudge): string | null {
	return nudge.type === 'task' ? nudge.description : null;
}

export function nudgeValidationType(nudge: Nudge): ValidationType | null {
	return isValidated(nudge) ? nudge.validation_type : null;
}

/** the pack a nudge needs downloaded before it can be scored, if any */
export function nudgeRequiredPack(nudge: Nudge): ModelPack | null {
	const validation = nudgeValidationType(nudge);
	return validation ? VALIDATION_PACK[validation] : null;
}

// #endregion
