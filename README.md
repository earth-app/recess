# 🛝 recess

> Go Outside

A micro-nudge app. A few small prompts a day, validated on-device, rewarded locally, visualized well.

**No server. No account. No competition. No social graph.** Everything lives in bundled JSON and device storage. The only network calls in the entire app are an optional weather lookup and a one-time model download - and the app works fine without either.

Part of the Earth App family alongside `crust` (web), `sky` (mobile) and `cloud` (backend). Recess borrows their patterns but **extends none of them**; it is standalone.

## What it does

Each day Recess picks four nudges - plus a bonus once those are resolved - from a catalog of 120, filtered by the clock, the season, the weather, your permissions and what you have already done. Some are things to do, some are questions, some are just something to sit with. Then the day ends. There is no feed, nothing to catch up on, nothing to scroll.

Some nudges can be checked. Photograph the thing you made and an on-device CLIP model decides whether it looks like what the nudge asked for. Write about what you found out and a sentence embedder scores it against a rubric. Say out loud what you hear and Whisper transcribes it first. All of it runs on the phone; nothing is uploaded, ever. If a model is missing or fails, the app says so and lets you mark it done yourself - it never silently passes.

Resolving nudges grows a **Playground**: a generative scene derived entirely from your completion history. Points scale that scene and unlock new _kinds_ of nudge. They buy nothing, because there is nothing to buy.

## Getting started

```bash
bun install
bun run dev            # http://localhost:3001
```

Native builds need Xcode (iOS) or Android Studio, plus ImageMagick for the icon pipeline:

```bash
brew install imagemagick
bun run sync:assets    # icons + splash for both platforms
bun run build:ios      # generate -> sync:version -> cap sync -> cap build
```

### Commands

| Command                               | What it does                                                        |
| ------------------------------------- | ------------------------------------------------------------------- |
| `bun run dev`                         | Nuxt dev server on :3001                                            |
| `bun run generate`                    | Static build into `.output/public` (aliased `dist/`)                |
| `bun run build:ios` / `build:android` | Full native build, including version sync                           |
| `bun run sync:assets`                 | `@capacitor/assets` + iOS light/dark/tinted variants + watchOS icon |
| `bun run sync:version`                | `package.json` version into pbxproj and `build.gradle`              |
| `bun run typecheck`                   | `vue-tsc -b --noEmit`                                               |
| `bun run test:unit`                   | Vitest gate lane                                                    |
| `bun run test:e2e`                    | Playwright against the static build                                 |
| `bun run test:eval`                   | On-device validator accuracy vs fixtures                            |
| `bun run test:eval -- --tiers`        | Tier 1/2/3 accuracy-vs-cost comparison                              |

**`typecheck` must keep the `-b`.** The root `tsconfig.json` is a solution-style config (`files: []` plus references), so a plain `vue-tsc --noEmit` type-checks nothing and exits 0 with real errors present.

## Architecture

```text
src/
  types/         nudge.ts is the contract - zod schemas + inferred types
  utils/         the engine, all pure and all unit-tested
    data.ts        locale-aware catalog loading + region-overlay merge
    filters.ts     filter evaluation (unknown values pass, never block)
    recommend.ts   the deterministic daily picker
    validate.ts    validation dispatch; fails CLOSED
    rubric.ts      embedding cosine scoring, ported from cloud
    ml.ts          transformers.js pipelines, lazily imported
    tiers.ts       the device-tier model table (plain data, deliberately)
    playground.ts  scene derivation from the ledger
    streak.ts      forgiving grace-day streak math
  stores/        pinia: nudges, progress, models
  composables/   platform + feature layer
  components/    nudge/ validation/ playground/ week/ onboarding/ ui/
  pages/         onboarding + tabs/{today,playground,week,settings}
  data/          the nudge catalog (see below)
```

The engine is deliberately separable from the UI: every pure function takes `now` as an explicit parameter rather than reading the clock, which is why most of the 400-odd unit tests need no fake timers.

### The daily pick is deterministic

`recommendDaily` seeds a PRNG from `hash(dayKey + locale)`, so the same day always produces the same set. The deck therefore survives a relaunch without persisting anything, and a test can assert an exact selection. Weighted sampling rather than a sort keeps it from becoming a fixed rotation.

Signals: category recency, type variety, a points spread across low/mid/high bands, duration versus remaining daylight, tag distance from yesterday, skip decay, cooldown, unlock gating, and a down-weight (never an exclusion) when a nudge's model pack is not installed.

### Storage

Capacitor's docs say localStorage "must be considered transient" because the OS may reclaim WebView storage under disk pressure. That is a no-guarantee caveat rather than routine eviction - but Recess has no server to fall back on, so:

- **`Preferences`** - everything the user owns: ledger, points, streak, bests, settings, onboarding, device tier, pack registry.
- **`Filesystem`** - model weights and captured media, plus the durable mirror behind Cache Storage.
- **`localStorage`** - disposable per-session UI state only.

`Preferences` is configured with the App Group `group.com.earthapp.recess`, which is also how the Watch and Widget read state. That shared `UserDefaults` suite _is_ the entire native bridge; only the Live Activity needs a custom plugin.

## The nudge catalog

Nudges are bundled JSON at `src/data/<locale>/<category>/<type>.json`.

- **9 categories**: `people` `adventure` `home` `learn` `cooking` `nature` `errands` `exercise` `art`
- **7 types**: `task` `question` `think` `choose` `create` `notice` `count`
- **Locales**: `en` and `es` are complete trees; `en-GB` and `es-MX` are sparse overlays merged over their base language by id.

### Adding a nudge

1. Open (or create) `src/data/en/<category>/<type>.json`. It is a JSON array.
2. Start typing - `.vscode/schemas/` gives autocomplete and validation for that exact type.
3. Run `bun run test:unit`. `tests/unit/utils/data.spec.ts` walks every file in the tree and enforces the invariants below.

```jsonc
{
	"id": "first_bird", // short slug, unique per category+type
	"icon": "mdi:bird", // a real Iconify name
	"color": "@green", // @alias, #hex, rgb() or rgba()
	"points": 10, // <=10 low, 11-19 mid, >=20 high
	"duration_minutes": 5, // optional; a real recommender signal
	"tags": ["birds"], // variety axis inside a category
	"prompt": "Find a bird and watch it until it does something.",
	"validation_type": "photo",
	"validation_data": {
		"labels": ["a photo of a bird on a branch"],
		"negative_labels": ["a photo of an empty sky", "a screenshot of a screen"],
		"threshold": 0.6,
		"require_fresh_exif": true
	}
}
```

**The `id` is the primary key** of the completion ledger, the cooldown tracker and the overlay merge. Never rename one - editing a title is safe, editing an id erases history.

### Invariants CI enforces

- ids are globally unique once composed as `<category>.<type>.<slug>`
- rubric weights sum to exactly 1.0
- every CLIP `label` is English and phrased `"a photo of ..."`, in **every** locale (CLIP is English-only, and these are internal prompts the user never sees)
- every photo nudge has `negative_labels` - without them the score has nothing to compete against
- thresholds sit in 0.5-0.9; unrelated content floors near 0.5 because of the `(cos+1)/2` normalization, so anything lower accepts everything
- every `leads_to` and `completed` filter points at a nudge that exists
- `es` mirrors every `en` id, and a region overlay only overrides ids present in its base

### Two non-obvious authoring constraints

- **`audio` nudges must ask the user to speak.** `validateAudio` transcribes first and returns `missed` on an empty transcript, so "record the ambient sound" is unpassable by construction.
- **`model_pack` and `permission` filters are AND.** `is: [...]` requires _every_ listed token. Audio scoring needs `is: ["audio", "text"]` - the transcriber _and_ the embedder.

### Filters

Enum filters use `is` / `is_not`. Numeric filters use `greater_than`, `greater_than_or_eq`, `less_than`, `less_than_or_eq`, `equals`, `between`, AND-combined within one `value`.

An unknown or indeterminate filter **passes**. Weather with no snapshot, daylight with no location, a cooldown on a never-completed nudge - all pass. Filters block only on a definite mismatch, so a user who denies every permission still gets a full day.

Weather comes from Open-Meteo (no key, no signup), cached 6 hours. The 27 conditions map the WMO 4677 subset Open-Meteo actually reports, plus derived groups (`any_rain`, `severe`, `hot`, `windy`, ...). **There is no `tornado`** - Open-Meteo does not emit that code, and inventing one would be a fabricated fact.

## On-device models

Four opt-in packs: `vision` (CLIP), `text` (sentence embeddings), `audio` (Whisper), `writing` (a small LLM for feedback lines and weekly reflections). Nothing downloads without an explicit tap.

On first launch a capability benchmark measures WebGPU availability, cores, reported memory and a real timed matmul, then assigns a device tier. Reported specs lie on throttled and low-battery devices, so the timed workload gets a veto - a slow device cannot reach tier 3 regardless of what it claims. Settings shows the detected tier and lets you override it.

Weights land in Cache Storage (transformers.js owns that) and are mirrored into `Filesystem`, because Cache carries the same no-guarantee caveat as localStorage and re-downloading hundreds of megabytes on a low-disk device would be a bad failure. Once a pack is installed, `env.allowRemoteModels = false` and the app is genuinely offline.

**Pack sizes are read from the Hugging Face file listing and from measured on-disk usage, never hardcoded.** If a size cannot be determined the UI says "Size unavailable" rather than inventing a plausible number.

Tier 3's models are provisional. `bun run test:eval -- --tiers` measures accuracy against latency and download cost on identical fixtures; if tier 3 does not earn its weight it collapses onto tier 2 by editing `src/utils/tiers.ts` and nothing else.

### Validation fails closed

crust and sky's client moderation fails _open_ because their server is the real gate. Recess has no server, so a silently-passing validator would mean the app lying. Every failure path - missing model, timeout, inference error, offline - returns `unavailable`, which the UI turns into an explicit "We couldn't check this one. Mark it done yourself?"

## Rewards

Grounded in the `behavior-design-evidence` skill. Tangible rewards for an already-enjoyed act _undermine_ intrinsic motivation (Deci/Koestner/Ryan 1999, all tangible d=-0.34; expected tangible d=-0.36); verbal feedback _enhances_ it (d=+0.33 in adults, d=0.11 ns in children). The worst contingency is rewarding mere participation (d=-0.40).

So points buy nothing. No shop, no cosmetics, no currency, no levels, no ranks, no titles. Crossing a threshold reveals a capability ("You Can Now...") and grows the Playground. Every progress cue is self-referential - "Your Longest Yet", never a number beside someone else's.

The streak carries one grace day per rolling seven, and two misses **pause** it rather than resetting to zero. There is no "you lost your streak" notification, ever.

Notifications are three calm daily digests (default 08:30 / 13:00 / 18:30) - batched digests beat both real-time notification and silence (Fitz 2019). They are goal-shaped and suppressed once the day is done.

## UI: Ionic for structure, Nuxt UI for decoration

Both libraries are installed and they are **not** interchangeable. `<UApp>` is never mounted - the root is `<IonApp>` - and every Nuxt UI overlay (`UModal`, `UPopover`, `useToast`, ...) teleports into that missing host. Ionic owns structure and every control; Nuxt UI is `UIcon`, `UBadge`, `UAvatar`, `UAlert`, `USeparator`, `UForm`, `UTable`, `UProgress`, `UTooltip`.

Tailwind utilities inside an `<Ion*>` or on a bare `<button>` need a `!` suffix, or Ionic's CSS silently wins.

Full conventions are in [CLAUDE.md](CLAUDE.md).

## Testing

Three lanes, different budgets.

- **Unit** (`tests/unit/`) - deterministic, local, free, a few seconds. `vi.hoisted` plus `vi.mock` above the subject import. Component tests live in `tests/unit/components/` and use `mountSuspended` from `@nuxt/test-utils/runtime`; the one caveat is that Ionic custom elements render as stubs under happy-dom, so assert on what the component itself decides and leave Ionic's own rendering to e2e.
- **E2E** (`tests/e2e/`) - Playwright against the static build. `native-mock.ts` fakes the whole Capacitor bridge via an init script, which is the only way these journeys are drivable in a browser given there is no backend to intercept. `*.mobile.spec.ts` runs on Pixel 7; `webkit` is opt-in and is the closest engine to the shipped WKWebView.
- **Eval** (`tests/eval/`) - validator precision and recall against labeled fixtures, with a threshold sweep that recommends the value to ship. Never hand-tune a threshold without re-running it.

## Dependency notes

**Do not bump `nuxt` past 4.4.x.** `nuxt@4.5` requires `@unhead/vue@^3` while `@nuxt/ui@4.10` and `@nuxtjs/ionic` still require `^2`. The ranges are disjoint, bun hoists v2, and `.nuxt/unhead-options.mjs` fails with `[MISSING_EXPORT] legacyPlugins`. The same trap is documented in crust and sky. `vitest` and `@vitest/coverage-v8` are pinned to exact `4.1.9` because 4.1.10 regressed the uncovered-file TS parser.

## License

See [LICENSE](LICENSE).

## Credits

- **Framework**: [Nuxt](https://nuxt.com/) by the Nuxt team
- **UI**: [Ionic](https://ionicframework.com/) for structure, [@nuxt/ui](https://ui.nuxt.com/) for decoration
- **On-device models**: [transformers.js](https://huggingface.co/docs/transformers.js) by Hugging Face
- **Icons**: [Iconify](https://iconify.design/)
- **Developed by**: [The Earth App](https://github.com/earth-app)
