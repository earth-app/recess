# Recess

A micro-nudge app. A few small prompts a day, validated on-device, rewarded locally, visualized well.

**No server. No account. No competition. No social graph.** Everything lives in bundled JSON and device storage. There is no backend to call and no `src/server` routes worth writing — if you find yourself reaching for the network, you are almost certainly solving the wrong problem. The only network calls in the entire app are the optional weather fetch and the one-time model-pack download.

Sibling repos for reference: `../crust` (Nuxt web), `../sky` (Ionic mobile), `../cloud` (Workers backend). Recess borrows patterns from all three but **extends none of them** — it is standalone, with no `@earth-app/crust` layer.

## Commands

```bash
bun run dev                  # nuxi dev on :3001, md styling
bun run dev:ios              # same dev server with .env.ios, so Ionic renders its ios variant
bun run dev:android          # same with .env.android (md)
bun run dev:ios:native       # build + cap sync + run on a simulator/device
bun run dev:android:native   # android equivalent

bun run dev:ios:debug        # dev:ios with DEV_MODE on (see "Developer mode")
bun run generate:ios:debug   # static build with DEV_MODE on
bun run build:ios:debug      # full native build with DEV_MODE on

bun run generate             # static build -> .output/public (aliased as dist/)
bun run generate:ios         # same, with .env.ios (NUXT_MODE=ios)
bun run build:ios            # generate + sync:version + cap sync + cap build
bun run sync:assets          # @capacitor/assets + iOS icon variants + watch icon (needs `magick`)
bun run sync:version         # package.json version -> pbxproj + build.gradle

bun run typecheck            # vue-tsc --noEmit
bunx prettier --check .
bun run test:unit            # vitest, gate lane, must stay under ~2s
bun run test:unit:coverage
bun run test:e2e             # playwright, prod static build, chromium + mobile-chromium
bun run test:e2e:webkit      # WKWebView-class engine
bun run test:eval            # on-device validator accuracy vs fixtures
bun run test:eval -- --tiers # tier 1/2/3 accuracy-vs-cost comparison
bun run test:eval:recommend  # recommender knob sweep

bun run maestro:ios          # build + install + drive the gate flows on a simulator
bun run maestro:android      # android equivalent (needs jdk 21)
bun run maestro:eval         # the eval-tagged flows only
```

## Hard rules

### Do not bump `nuxt` past 4.4.x

`nuxt@4.5.x` requires `@unhead/vue@^3`; `@nuxt/ui@4.10` and `@nuxtjs/ionic` still require `^2`. Disjoint ranges, so bun hoists v2 and `.nuxt/unhead-options.mjs` fails with `[MISSING_EXPORT] legacyPlugins`. Same trap already documented in crust and sky. Hold `nuxt` at `~4.4.8` until `@nuxt/ui` declares `@unhead/vue@^3`, then bump both together.

`vitest` and `@vitest/coverage-v8` are pinned to exact `4.1.9` — 4.1.10 regressed the uncovered-file TS parser and silently drops files from coverage.

### Never run a git write command

No `commit`, `push`, `add`, `checkout`, `stash`, `reset`, `branch`, `merge`, `rebase`, `tag`, `restore`, `clean`. Work stays uncommitted in the working tree unless Gregory explicitly asks in that same message. Read-only git (`status`, `diff`, `log`, `show`) is always fine.

## UI: Ionic for structure, Nuxt UI for decoration

Both libraries are installed. They are **not** interchangeable, and the split is not stylistic.

`<UApp>` is never mounted — the root is `<IonApp>`. Every Nuxt UI overlay (`UModal`, `UPopover`, `UDrawer`, `USlideover`, `UDropdownMenu`, `UCommandPalette`, `useToast`, `useOverlay`) teleports into the `<UApp>` host. With no host, **they cannot work**. This is why sky uses `IonButton` ×245 and `UButton` ×0 while crust, same `@nuxt/ui` version but no Ionic, uses `UButton` ×393.

**Use Ionic for:** `IonApp` `IonPage` `IonContent` `IonHeader` `IonToolbar` `IonTitle` `IonButtons` `IonBackButton` `IonTabs` `IonTabBar` `IonButton` `IonInput` `IonTextarea` `IonSelect` `IonCheckbox` `IonRadioGroup` `IonToggle` `IonRange` `IonSegment` `IonModal` `IonPopover` `IonList` `IonItem` `IonLabel` `IonChip` `IonSpinner` `IonProgressBar` `IonRefresher` `IonSearchbar` `IonDatetime`

**Use Nuxt UI for:** `UIcon` `UBadge` `UAvatar` `UAlert` `USeparator` `UForm` `UFormField` `UTable` `UInputNumber` `UFileUpload` `UProgress` `UTooltip` `UCalendar`

**Never use:** `UApp` `UButton` `UInput` `UTextarea` `USelect` `USelectMenu` `UModal` `UPopover` `UDrawer` `USlideover` `UDropdownMenu` `UCommandPalette` `USwitch` `UCheckbox` `URadioGroup` `UTabs` `UAccordion` `UCollapsible` `USkeleton` `UToast` / `useToast` / `useOverlay`

Substitutes for the overlays: `IonModal` with `:breakpoints` for a bottom sheet, `IonPopover` for an anchored menu, `IonActionSheet` for a choice list, `@capacitor/toast` for toasts, `@capacitor/dialog` for confirms. Where `UForm` cannot wrap Ionic inputs, run the `zod` schema by hand.

### Tailwind inside Ionic needs `!`

Append `!` to any Tailwind utility on a bare `<button>` / `<input>` / `<textarea>` / `<select>` / `<a>`, or on anything inside an `<Ion*>` component or its slots. Ionic's global CSS and shadow-DOM defaults win over plain utilities, and the styles silently do nothing without it.

```vue
<IonButton class="rounded-full! px-4! text-sm! font-semibold!">Mark It Done</IonButton>
```

Plain non-Ionic `<div>` / `<span>` do not need it.

### Tap targets are 44px, enforced in `main.css`

Apple's HIG minimum, and Ionic's defaults land under it — toolbar buttons rendered at 32px and the model-pack Download button at 25px. `main.css` carries the floor unlayered, in two rules rather than one: a bare `ion-button` selector loses to Ionic's own `.sc-ion-buttons-md-s ion-button`, so toolbar buttons need `ion-buttons[class] ion-button` to outrank it (the `[class]` matches whichever `-md-`/`-ios-` scope class the current mode generated).

- `min-height` on the host is enough — `.button-native` tracks it, so the drawn button grows with the hit area rather than leaving an invisible margin.
- **Interactive chips carry the height themselves** (`h-11!`), because the decorative ones (playground biomes, `h-7!`) are labels, not controls. A chip that responds to a tap also needs `role="button"`, `tabindex="0"`, `:aria-pressed`, and `@keydown.enter`/`@keydown.space` — Ionic gives `IonChip` none of that.
- `tests/e2e/layout.mobile.spec.ts` measures every surface at Pixel 7 width and fails on anything under 44px, on horizontal overflow, and on text clipped by its own box. It is the only occupant of the `mobile-chromium` project; before it, nothing ran at phone width.

## Conventions

- **`<template>` before `<script setup>`** in every `.vue` file. The formatter reorders on save, so author it that way.
- **Components** live in folders by domain with shorthand names — Nuxt prepends the folder to derive the auto-import name. `nudge/Card.vue` → `<NudgeCard>`, never `nudge/NudgeCard.vue`. Only folderless top-level components carry a full name.
- **Comments** are lowercase, one short line, no trailing period, and only where the _why_ is non-obvious. Two lines maximum. No file-header comment blocks. No comments in `<template>` at all unless a component is genuinely unreadable without one. TSDoc `/** */` only on real exported contracts.
- **Casing** has two registers, and picking the wrong one is the most common copy mistake here. See "Casing" below.
- **ASCII only** in code, strings, and comments. No em dashes (use `-` or `;`), no curly quotes, no fancy arrows.
- **`// #region name` / `// #endregion`** to group a section, not dashed dividers.
- **One file per domain.** Prefer extending an existing `src/utils/*.ts` or composable over adding a sibling. `useSettings.ts` owns all settings; `filters.ts` owns all filter evaluation.
- Prettier: tabs, single quotes, `printWidth` 100, `singleAttributePerLine`, no trailing comma, semicolons.

## Storage

Capacitor's docs say localStorage "must be considered transient" because "the OS will reclaim local storage from Web Views if a device is running low on space." That is a no-guarantee caveat, not routine eviction — but Recess has no server as a fallback, so `Preferences` is the only durable store available.

- **`Preferences`** — everything the user owns: completion ledger, points, streak, personal bests, settings, onboarding state, notification times, device tier, model-pack registry. Losing any of it would read as the app breaking.
- **`Filesystem`** — model weights and captured media. Also the durable mirror behind Cache Storage, since Cache carries the same caveat and re-downloading hundreds of MB is a bad failure.
- **`localStorage`** — disposable per-session UI state only: mid-swipe card index, a banner dismissed for today, scroll offsets.

## Validation must fail closed

Unlike crust/sky's `useClientModeration`, which fails **open** because the server is the real gate, Recess has no server. A validator that silently passes means the app lies to the user.

Every failure path — model missing, timeout, inference error, offline — falls back to **explicit self-attestation**: "We couldn't check this one. Mark it done yourself?" The user is never blocked and never quietly cheated. Never `return { passed: true }` on an error.

## The Playground and its share code

The scene is a pure function of `(installSeed, traits, ledger categories, points, sky)`. Two properties are load-bearing:

- **Identity is structural, not tinted.** The install seed's first draws pick a `paletteFamily` (which replaces the whole time-of-day palette set) and a `layoutGrammar` (which replaces the placement function, not parameterises one). Varying hue and jitter alone reads as the same picture twice.
- **Geometry is derived from `(sceneSeed, index)`**, never stored. Only a category comes from the ledger. That is what lets a shared scene cost 4 bits per element instead of 20, and what keeps a growing scene from reshuffling.

`SCENE_SCHEMA_VERSION` salts both the trait hash and the scene hash, so a redesign leaves older exports rendering the picture the user actually saw. Pin new rules behind a version bump rather than editing the old path.

**The install seed never leaves the device.** A share code carries the traits outright plus an _ephemeral_ `hash(installSeed + day)`. Sending the real seed would hand a stable per-install identifier to whoever scanned it. The consequence is deliberate: placement is re-rolled, so a shared scene is not byte-identical to the sender's - which is why the share sheet previews `shareableTuple()` rather than the sender's own scene. What they see is what the other person gets.

The payload is bit-packed and base45'd, **not** JSON+deflate: deflate only removes statistical redundancy from JSON text, never the structural tax, so a JSON scene lands past every scannable QR version. Base45 costs 3% against raw byte mode but is the only thing that survives the string-only APIs in both `html5-qrcode` and `@capacitor/barcode-scanner`. A full 160-element playground encodes to **QR version 7, 45 modules** - well inside the ~v20 practical ceiling for a screen-to-screen scan.

A scanned scene lives in component state only, never in `Preferences` or `localStorage`; closing the sheet is what makes it a one-time view, and the day bound in the payload is what stops the code working tomorrow.

## Data model

Nudges are bundled JSON at `src/data/<locale>/<category>/<type>.json`. `src/data/colors.json` is locale-independent and mirrored into the `@theme` block in `src/assets/css/main.css` — keep both in sync.

- **Categories** (9): `people` `adventure` `home` `learn` `cooking` `nature` `errands` `exercise` `art`
- **Types** (7): `task` `question` `think` `choose` `create` `notice` `count`
- **Locales**: `en` and `es` are complete trees; `en-GB` and `es-MX` are sparse overlays merged over their base language by `id`.

Every nudge needs a stable `id` (`nature.notice.first_bird`). It keys the completion ledger, cooldowns, overlay merging, and the deterministic day picker — editing a title must never erase history.

`color` accepts `@alias` (from colors.json), `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`.

Filters come in two families: **enum** filters use `is` / `is_not`; **numeric** filters use `greater_than`, `greater_than_or_eq`, `less_than`, `less_than_or_eq`, `equals`, `between`, AND-combined within one `value`. An unknown or indeterminate filter **passes** — filters block only on a definite mismatch, never on missing data.

CLIP `labels` are authored in **English in every locale**. They are an internal model prompt the user never sees, which sidesteps CLIP being English-only.

Two non-obvious authoring constraints:

- **`audio` nudges must ask the user to speak.** `validateAudio` transcribes first and returns `missed` on an empty transcript before it ever scores, so an "record the ambient sound, no talking" nudge is unpassable by construction. Phrase them as "say out loud what you hear" and write the rubric `ideal`s as spoken sentences.
- **`model_pack` and `permission` filters use AND semantics.** `is: [...]` requires _every_ listed token to be present, not any one of them. An audio nudge needs `is: ["audio", "text"]`, because scoring a transcript needs the transcriber _and_ the embedder.

JSON schemas in `.vscode/schemas/` drive editor autocomplete; the equivalent `zod` schemas in `src/types/nudge.ts` are what CI actually enforces. Keep them in step.

## Developer mode

`NUXT_PUBLIC_DEV_MODE=1` (set by every `*:debug` script) unlocks a panel for reaching states the app normally gates behind progression: jump to a points threshold, fabricate a multi-week ledger with gaps, pin any nudge past every filter, release the bonus early, force a validator verdict, mark model packs present without downloading, override the clock/season/moon/weather the filters read, and fire a real digest notification a second out.

Two rules keep it out of production:

- **`__DEV_MODE__` is a Vite-injected literal, not a runtime flag.** `src/app.vue` reaches the panel through `DEV_MODE ? defineAsyncComponent(() => import('./components/dev/Launcher.vue')) : null`. In a production build the literal folds to `false`, so Rollup drops the `import()` and everything it reaches. A runtime `v-if` would still emit the chunk.
- **The `/dev` route is stripped in `pages:extend`.** A page is always reachable from the router manifest, so gating it in the template would still ship it.

`src/utils/dev.ts` is the one part that ships either way. Every reader opens `if (!DEV_MODE) return <untouched>`, which folds to `if (true)` and shrinks each function to its pass-through, so it is kept to plain state and guards for exactly that reason. New overrides go there; the panel and its actions go under `src/components/dev/`, which is the part that gets eliminated.

Fabricate state through the real code paths. The panel reaches a points total by recording actual completions rather than assigning `points`, because points, streak, bests, unlocks and the Playground are all derived from the ledger - writing the number directly produces a state the app can never reach and misleads more than it helps.

## Casing

Two registers. Full Title Case everywhere reads stiff and corporate, which is the wrong feel for this app.

**Title Case — names of surfaces.** Page titles, tab labels, section headers, settings rows, modal titles, and buttons that are noun phrases. Small words stay lowercase mid-title (`a an the and or nor but of to in on at by for`).

> `Your Data` · `On-Device Models` · `Nudges per Day` · `Download Models` · `Erase Everything`

**Casual case — anything a person would say out loud.** Questions, prompts, encouragements, and buttons that are spoken phrases. Capitalize the first word and the words carrying the emphasis; leave every **function word** lowercase, _including the last word_.

Function words: articles (`a an the`), prepositions (`of to in on at by for from with`), conjunctions (`and or but if as than that`), particles (`up on off out`), **pronouns** (`you we it they this that your our my`), and **auxiliary or modal verbs** (`is are was do did have has can could should will would`). The main verb is not a function word and stays capitalized.

> `What are you Drawn to?` not `What Are You Drawn To?`
> `When should we Nudge?` not `When Should We Nudge?`
> `Mark it Done` · `Did you Do it?` · `Grown from 12 Nudges` · `How it Grows`

The tell is whether the string names a thing or says a thing. `This Week` as a section header is Title Case; `This Week is Still Blank` is a sentence about the week, so `is` drops.

Spanish follows the same rule with Spanish function words (`el la los un una lo de del a al en con por para y o si que como` plus unstressed pronouns `te tu su se le lo me` and auxiliaries `es son está puede puedes ha`): `¿Que te Llama?`, `Ver tu Semana`, `Lo que Ya puedes Hacer`.

Body copy, hint text, help text, and placeholders stay plain sentence case in both registers.

## Tone of nudge copy

Casual, second person, specific, a little strange. The bar is "Is 100 friends too many or not enough?", not "Take a moment to reflect." Avoid therapeutic blandness, avoid exclamation marks stacked on encouragement, avoid anything that reads like a wellness app.

## Rewards are informational, never transactional

Grounded in the cited evidence base in `../crust`'s memory (`reference_engagement_psychology_evidence`). Expected tangible rewards for an already-enjoyed act _undermine_ intrinsic motivation (Deci/Koestner/Ryan 1999, d=-0.34); verbal feedback _enhances_ it (+0.33).

- Points buy **nothing**. No shop, no cosmetics, no currency. They scale the Playground and unlock capability ("You Can Now …"), never goods.
- No levels, no ranks, no titles — those smuggle comparison into a single-player app.
- All progress cues are self-referential: "Your Longest Yet", never a number next to someone else's.
- The streak is forgiving by construction: one grace day per rolling 7 days, and two misses **pause** it rather than resetting to zero. There is no "you lost your streak" notification, ever.
- Sessions are finite. The day ends with a real end-state and nothing to load more of.

## Notifications

Three calm daily digests (defaults 08:30 / 13:00 / 18:30) — 3 batched digests beat both real-time and silence (Fitz 2019). Goal-shaped, suppressed once the day is complete.

Notification id bands must stay disjoint and under the 32-bit signed max:

- per-nudge reminders `[2_000_000_000, 2_100_000_000)`
- daily digests `[2_100_000_000, 2_110_000_000)`

No `repeats: true` — digest content is dynamic, so a rolling window of one-shots is rebuilt on foreground, throttled to 30 min. Notifications only stay fresh if the app is opened within the window; that is by design.

## Native iOS

Three targets: `App`, `Watch`, `Widget`. The App Group `group.com.earthapp.recess` is the entire bridge — `Preferences.configure({ group })` writes a shared `UserDefaults` suite that Swift reads with `UserDefaults(suiteName:)`. No custom plugin needed for the widget or watch; only the Live Activity needs one.

`WidgetBundle` must use the single-body `if #available(iOS 16.1, *) { … }` form — `WidgetBundleBuilder` has no `buildEither`, so a mixed-availability bundle will not compile any other way.

The watch is **read-only**. It receives notifications and renders the day's ring from the App Group snapshot; it never writes state back.

## Testing

Three lanes, different budgets.

**Unit** (`tests/unit/{utils,stores,composables}/`) — deterministic, local, free, under ~2s. `environment: 'nuxt'`, `globals: true`. Idioms, copied from sky:

- `vi.hoisted` + `vi.mock` declared **above** the subject import. `mockNuxtImport` also works and is what crust uses for component specs; `vi.mock` is simply what most of these files already do.
- Pure functions take `now` as an explicit parameter instead of reading the clock, so most tests need no fake timers at all.
- Local factory helpers with `Partial<T>` overrides rather than shared fixtures.
- **Component tests are welcome**, following crust's pattern in `tests/unit/components/`: `mountSuspended` from `@nuxt/test-utils/runtime`, `mockNuxtImport` where a composable needs replacing. `@nuxt/test-utils`, `@vue/test-utils` and `happy-dom` are installed.
- The one real caveat: **Ionic custom elements render as stubs** in happy-dom, so `ion-chip` and friends never appear in the output. Assert on what the component itself decides — computed classes, inline styles, `aria-*`, slot text, emitted events — and leave Ionic's own rendering and gestures to e2e.

**E2E** (`tests/e2e/`) — `*.mobile.spec.ts` runs on Pixel 7, everything else Desktop Chrome, `webkit` opt-in. Full journeys, not smoke tests. `native-mock.ts` fakes the Capacitor surface via init script.

**Eval** (`tests/eval/`) — labeled fixtures per validator and locale, reports precision/recall against thresholds, fails below a floor. This is how thresholds get calibrated; never hand-tune a threshold without re-running it.

**Maestro** (`.maestro/`) — the real WKWebView on a booted simulator, via `bun run maestro:ios` / `maestro:android` / `maestro:eval`. Covers what a headless Chromium cannot: the OS permission store, process death, and the native share sheet. Tagged `gate` / `eval` and split with `--include-tags`. Unlike sky there is no mock server to stand up, so this lane and `test:e2e` can run at the same time.

Selector rules, all load-bearing:

- **`id:` selectors do not work.** WKWebView publishes no `resource-id` for DOM content, so a stable DOM id is useless to Maestro. **`data-testid` is invisible** to the accessibility tree as well. Everything is selected by accessible name, and `tests/unit/maestro/flows.spec.ts` bans the other forms.
- **Ionic composes a tab button's name from its children** unless the host carries `aria-label` — which made the Today tab read as "Today 4" and change on every resolution. `src/pages/tabs.vue` pins `:aria-label="tab.label"` and marks the badge `aria-hidden`.
- **`config.yaml` must be exactly that name**; every flow file is `.yml`. Pass the workspace as `.maestro`, not `.maestro/flows` — the `flows:` globs are workspace-relative.
- **`env` defaults are not interpolated into `launchApp.permissions`**, and iOS `location` takes `never`/`inuse` while Android takes `allow`/`deny`. Branch on `when: platform:`.
- **`takeScreenshot` is sandboxed** under `--test-output-dir`, so paths are relative and carry no extension.
- **Never `xcodebuild -sdk`** — it overrides `SDKROOT` for every target in the scheme, so the Watch target compiles against the iOS SDK and dies on `WatchKit`. `-destination 'generic/platform=iOS Simulator'` is correct and needs no Maestro-only scheme.

Two guards keep it honest in the sub-2s unit lane, so a rename fails locally instead of 12 minutes into a device run: `tests/unit/maestro/flows.spec.ts` (YAML validity, one lane tag each, real command names, no banned or optional assertions, `runFlow` paths resolve) and `tests/unit/maestro/labels.spec.ts` (every selector must be an exact message value in `i18n/locales/en.json`, or listed as OS-owned or derived with the message that renders it).

**Genuinely unreachable, do not fake:** recess registers no `CFBundleURLTypes`, so there is no custom-scheme deep link to drive; its entry points are the three iOS home-screen shortcut items and Maestro has no command to invoke one. Camera and microphone surfaces are content-dependent (they only appear on a nudge the day happened to draw), so the deterministic permission coverage is notifications, and `resolve-a-nudge.yml` branches on whatever type the day served.

Every feature ships with its tests in the same change. Every bug fix ships with the regression test that would have caught it.

## Never invent a fact the user reads as real

Model pack sizes come from the real HF file listing and measured on-disk usage — never a hardcoded "≈50 MB". Weather conditions come from the WMO codes Open-Meteo actually returns; `tornado` is **not** one of them, so it is not offered. If a value is unknown, omit the field or read it from config. A plausible fake is worse than a blank.
