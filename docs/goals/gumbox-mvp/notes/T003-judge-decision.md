# T003 — Judge Decision: First Worker Slice + Tranche Sequence

Decision: **approved**. First slice = core Gumbox runtime as one vertical slice, no browser, no CLI, proven end-to-end by `pnpm test` against an in-repo fixture.

## Binding ambiguity resolutions

- **MVP wedge**: tranche = core runtime + minimal CLI run path (`gumbox run` / `list`, selectors, `--json`) — NOT the full 8-command cli.md surface. `open`, `types`, `preview`, `replay`, `doctor` are post-tranche; `init`/`migrate` non-MVP.
- **Receipt format**: pretty-printed JSON at `.gumbox/receipts/<ISO-8601 UTC, colons->dashes>/receipt.json`, schema-versioned `gumboxReceipt: 1`, one dir per run, plus a `latest` plain-text pointer file (not a symlink).
- **Exit codes** (applies from CLI slice): 0 = all passed; 1 = box failure (receipt path printed, receipt still written); 2 = usage/discovery/config/infrastructure error.
- **Fixture strategy**: gumbox's own tests use minimal in-repo framework-free Vite fixtures under `test/fixtures/<name>/`, copied to a temp dir per test. qwik-bundler is read-only design reference only; nothing at test time resolves outside this repo.
- **Browser in slice 1**: deferred to slice 4. HMR/SSR/receipt evidence observable from Node via dev-server hot-channel WebSocket (Node 22 global WebSocket) + internal plugin `hotUpdate` hooks. `BoxContext.browser` key exists from day one but `visit()` throws a clear "later slice" error.

## Slice 1 contents

- `box(name, run)` / `box(options, run)`; `BoxOptions {name, tags?, modes?, ui?}`; six-key `BoxContext {environment, browser, project, pipeline, expect, receipt}`.
- Box discovery: `*.box.ts(x)`, default + named exports, actionable invalid-box errors; programmatic API (`discoverBoxes`/`runBoxes`).
- `pipeline.dev()` via `createServer` with `pipeline.dev({config})` overlay; environments from `server.environments`; capability gating: `request(path)` (fetchable), `import(id)` (runnable via runnableDevEnvironment); `visit()` reserved.
- `project.edit(path, {replace})` + function-style edit, `project.read`/`project.exists`; real-watcher writes, before/after diff, guaranteed restore (failure marked in receipt). `edit.create/remove/copy/config` deferred to slice 2.
- Evidence: hot-channel WS client capturing update/full-reload/custom/error; internal gumbox plugin observing hotUpdate + restarts; normalized per-environment `EnvironmentEditOutcome {update, fullReload, restart, error, invalidated, updates, plugins}` correlated to causing EditReceipt.
- Minimal expect: `expect.environment.<name>.hotUpdate/noFullReload/invalidated/notInvalidated/satisfies`, `expect.html.contains`; results recorded in receipt; failures throw with receipt-pointing messages.
- `receipt.capture/note/measure`; automatic events (box file/export, config path, env names, server URL, edits+restoration, timeline, assertions, machine summary).
- Receipt to disk per run as specified above.
- Fixture `test/fixtures/basic`: vanilla Vite app (index.html, src/message.ts, vite.config.ts with client + one ssr environment), zero framework deps.
- Vitest tests: discovery; box edits src/message.ts and receives real HMR update with no full reload; ssr-vs-client invalidation isolation; receipt with diff + events + latest pointer on disk; restore verified including on box failure.

## Tranche sequence

- slice 2: `project.edit.create/remove/copy/config`, `expect.pipeline.serverRestarted`, `pipeline.build()` via createBuilder (+ fallback), `build.artifact()`, `expect.build.*`/`expect.artifact.*` — covers canonical scenario 3 (artifact scan + leakage check).
- slice 3: CLI — bin wiring, `gumbox [selector]`/`run`/`list`, selector matching, `--json`, `--receipt-dir`, exit codes, receipt path on failure. Completes tranche oracle.
- slice 4: browser evidence — Playwright, `visit()`, `expect.page.*`, screenshots, console/network capture, `pipeline.preview` + `preview.browser`, alias-target recording.
- slice 5: `/__gumbox` dev middleware — metadata, state gallery, local-only receipt APIs, port guards; `gumbox open`.
- slice 6: typegen (`.gumbox/types`, `Known<T>` unions) + `gumbox types`, then `doctor`, `replay`.

## Risks

- Hot-channel payloads may not flush without a connected browser client; plugin hotUpdate hook is the fallback evidence source; if both fail → spec/reality stop_if.
- No blind sleeps: event-driven waits with bounded timeouts only (the qwik-bundler failure mode this tool replaces).
- No always-pass spec-shaped stubs in expect.
- `vp pack` multi-entry/bin constraints are slice 3's problem.
