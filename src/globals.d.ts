/** Injected by `vite.define` in nuxt.config.ts, from package.json. */
declare const __APP_VERSION__: string;

/**
 * `true` only in a `dev:*:debug` / `generate:*:debug` build.
 *
 * A literal, not a runtime lookup, so `if (__DEV_MODE__)` folds to `if (false)` in
 * production and Rollup drops the branch along with anything it imports.
 */
declare const __DEV_MODE__: boolean;
