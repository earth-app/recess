// region files only carry the keys that differ. vue-i18n decomposes a region
// locale before reaching the fallback, so `es-MX` resolves es-MX -> es -> en on
// its own; an explicit fallback map would be redundant.
export default defineI18nConfig(() => ({
	legacy: false,
	fallbackLocale: 'en',
	fallbackWarn: false,
	missingWarn: false
}));
