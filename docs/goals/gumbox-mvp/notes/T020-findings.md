# T020 findings: qwik-bundler integration phase 2 (nitro + workerd)

Result: all 7 remaining smoke scripts are replaced by gumbox boxes running
green in qwik-bundler (branch `gumbox-scripts`), through the linked `gumbox`
CLI. The full 9-box set (2 csr + 3 nitro + 4 workerd) passed three full runs;
`fixtures/` stayed git-clean after every run. workerd runs natively in this
environment (cloudflare plugin dev + preview), so nothing was deferred.

Script -> box mapping (all in `qwik-bundler/boxes/`):

| Script | Box |
| --- | --- |
| smoke-vite-nitro-hmr.mjs | nitro-hmr.box.ts |
| smoke-vite-nitro-remove-handler-hmr.mjs | nitro-remove-handler-hmr.box.ts |
| smoke-vite-nitro-remove-signal-hmr.mjs | nitro-remove-signal-hmr.box.ts |
| smoke-vite-workerd-hmr.mjs | workerd-hmr.box.ts |
| smoke-vite-workerd.mjs | workerd-build.box.ts (see oracle note) |
| smoke-vite-workerd-router.mjs | workerd-router-dev.box.ts |
| smoke-vite-workerd-router-browser.mjs | workerd-router-browser.box.ts |

New scripts: `test:boxes` (`pnpm build && gumbox`), `test:hmr-boxes` now runs
the `hmr` tag. `scripts/` left untouched per phase constraint.

## Multi-environment causality (the new ground)

The receipts now show per-edit, per-environment divergence — and the two SSR
fixtures diverge *differently*, which the boxes pin down explicitly:

**nitro fixture** (envs `client`, `ssr`, `nitro`), edit `src/home.tsx`
(receipt 2026-06-10T07-13-47.523Z):

```
client { fullReload: false, invalidated: [],            customPayloads: [qwik:hmr x3] }
ssr    { fullReload: true,  invalidated: [/src/home.tsx], customPayloads: [] }
nitro  { fullReload: false, invalidated: [],            customPayloads: [] }
```

The resumable client never imported home.tsx, so its module graph holds
nothing for the file (`notInvalidated` passes) and its whole reaction is the
qwik:hmr custom protocol. The `ssr` environment renders the page: it
invalidates the module and full-reloads its *server module runner* (asserted
via `ssr.satisfies(o => o.fullReload && !o.restart && o.error === null)`)
while the browser document never navigates (`page.noNavigations`). The
`nitro` environment observes the file change but owns no module for it.
Timeline interleaves all three: seq 15 file edited -> 16 client hook (0
modules) -> 17 qwik:hmr broadcast -> 18 ssr hook (/src/home.tsx) -> 23 nitro
hook (0 modules) -> qHmr in the page -> file restored.

**workerd fixture** (envs `ssr`, `vite_workerd_fixture`, `client`), same kind
of edit (receipt 2026-06-10T07-29-13.747Z):

```
ssr                  { invalidated: [],              customPayloads: [] }      (vestigial default env)
vite_workerd_fixture { invalidated: [/src/home.tsx], customPayloads: [] }      (workerd SSR renderer)
client               { invalidated: [/src/home.tsx], customPayloads: [qwik:hmr x3] }
```

Opposite client behavior to nitro: this fixture has a real client entry
(index.html -> src/main.tsx) importing the component tree, so the client
invalidates too. Each box asserts its fixture's exact divergence shape, so a
topology regression in either fixture fails the box.

## Event-driven settle points (no sleeps anywhere)

- The original remove-handler script slept 250ms after the click. Audit of a
  first attempt showed the naive replacements are unsound: (1) qwik drops the
  SSR `q-e:*` attributes on *every* re-render (handlers rewire via an
  expando), so "attribute gone" settles before the re-render finishes; (2)
  `qsymbol` also fires for HMR re-renders (`_hmr`, component symbols), so a
  bare `atLeast: 1` settles early. Final design: after the edit, wait for the
  page `qHmr` event plus the re-rendered component's own qsymbol
  (`detailIncludes: 'home_component'`); click the inert button, then a live
  sibling, and settle on `qsymbol` with `detailIncludes: 'q_e_click'` — only
  a click QRL produces that. Then assert no increment ('Count 0'), clean
  console, no failed requests, no navigations.
- State preservation (canonical scenario 2): click counter to 8, remove the
  button (text gone, sibling 'New Count 0' intact), re-add it, and 'Count 8'
  reappears — receipt shows both edit diffs with `restored: true`, all 8
  clicks as interactions, 2 qHmr events, zero navigations.

## Falsifiability (proven during development, then reverted)

- remove-handler: a falsified edit that *keeps* the handler made the box fail
  with `expected 'main button:first-of-type' to have text "Count 0", but it
  was "Count 1"` (receipt 2026-06-10T07-26-22.906Z). The same falsified run
  against the naive attribute/qsymbol oracle had *passed*, which is what
  forced the settle-point redesign above.
- remove-signal: an injected `page.reload()` before the final assertion made
  the box fail with `expected the page body text to contain "Count 8"`
  (receipt 2026-06-10T07-24-21.482Z) — a reload cannot fake preservation.
- nitro-hmr: the inherited draft asserted `client.invalidated`, which fails
  against the real fixture (client graph has no module) — evidence the
  per-environment assertions are not vacuous.

## smoke-vite-workerd.mjs oracle note (partial out-of-scope)

The original imports the *built* worker module in Node and calls
`worker.fetch(request, { ASSETS: fake404 })`. Two behaviors are entangled:
(a) the built worker's fetch handler SSR-renders HTTP 200 HTML with the
markers, and (b) the built module is importable in plain Node with a
synthetic binding. `workerd-build.box.ts` preserves (a) through gumbox's
existing surface: `pipeline.build` (config overlaid to the fixture) +
`expect.build.environment/artifact` + `expect.artifact.json` (wrangler.json
has a `main` entry) + `pipeline.preview`, where the cloudflare plugin runs
the real built output inside workerd. `/` is answered asset-first by the
client shell (real deploy semantics, asserted), and a non-asset route falls
through to the worker, whose SSR HTML carries all three markers
(`preview.request` throws on non-200, so success is the status assertion).
Behavior (b) — dynamic Node import of an arbitrary built file plus a
hand-built binding object — is host-runtime-specific and deliberately NOT
added to gumbox's spec surface; recorded here as out of scope.

## Gumbox improvements (TDD, 44/44 tests green)

1. **CLI always exits** (`src/cli/host.ts` `exitHost`, bin shim): nitro's dev
   pipeline leaks runtime handles past `server.close()`, which left the CLI
   process alive forever after printing results. The host shim now flushes
   stdout and force-exits with the run's code. Host-boundary behavior;
   verified through the linked CLI (every nitro run now terminates).
2. **Tracked event details survive gnarly payloads** (`src/browser.ts`):
   framework event details carry DOM nodes and circular references (qwik's
   qsymbol carries the target element); the previous plain JSON round trip
   degraded the whole detail to `'[object Object]'`. The in-page recorder now
   uses a replacer ([element button], [node …], [circular], [function]) so
   the rest of the detail stays structured. Test: `fixture:gnarly` event in
   `test/fixtures/browser`.
3. **`expect.page.event(..., { detailIncludes })`** (`src/expect.ts`,
   `src/types.ts`): scopes the event-driven wait to occurrences whose
   serialized detail contains a substring — the settle-point pattern when a
   framework fires one event name for many reasons. Falsifiability covered by
   a box whose needle never matches.
4. **Root-overlaid builds record artifacts** (`src/build.ts`): with
   `config: c => ({...c, root: fixture})`, outDirs were taken config-relative
   and the artifact scan found 0 files (the workerd build receipt proved it).
   outDirs and artifact paths are now normalized to runner-root-relative
   (test: build box in `test/fixtures/nested`); `BuildHandle`/`BuildRecord`
   doc comments updated. Receipt schema stayed additive.

## Receipt excerpts

workerd-build (receipt 2026-06-10T07-35-08.671Z): builds
`['vite_workerd_fixture', 'client']`, outDirs
`fixtures/vite-workerd/dist/{vite_workerd_fixture,client}`, 21 artifacts,
preview record (`url`, `buildId: build-1`, `outDir`), assertions
build.environment x2, build.artifact, artifact.json, html.contains x4.

workerd-router-dev: `response.matches` evidence for `/` (200, text/html,
router loader greeting) plus `expect.html.contains` for `/@vite/client` and
the virtual stylesheet link, and for `/@id/virtual:qwik-router/dev-styles.css`
(200, text/css, compiled `rgb(17, 24, 39)` from the fixture's global.css).

workerd-router-browser: computed `h1` color `rgb(253, 186, 116)`, counter
click 0 -> 1 (interaction + text assertions), cleanConsole, noFailedRequests,
snapshots before/after.

## Verification

- gumbox: `deno task test` 44/44, `deno task build`, `deno task check` all
  green (T019's middleware-residue caveat is gone; the worktree was clean).
- qwik-bundler (`gumbox-scripts`): full 9-box set green 3 times through the
  linked CLI; `git status fixtures/` clean after every run; csr boxes still
  green; `pnpm check` green.

## Notes

- The nitro fixture logs a benign dep-scan warning through the linked CLI
  (`failed to resolve rolldownOptions.input "./src/root.tsx"` — resolved
  relative to the process cwd, not the overlaid root). Pre-bundling is
  skipped; HMR behavior is unaffected. Same warning shape exists for the
  original scripts run from the repo root.
- The dual-vite-instance compatibility note from T019 still applies
  (gumbox's vite 8.0.16 next to qwik-bundler's; no issues across all runs).
