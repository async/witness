# CLI

## CLI Principle

The Async Witness CLI should make Vite pipeline QA feel like one tool instead of a
folder of bespoke smoke scripts.

It should own the repetitive work developers currently hand-roll:

- discover `*.box.ts` and `*.box.tsx` boxes
- load the user's Vite config
- discover named Vite environments
- start or connect to Vite dev
- run Vite build through `createBuilder(...)` when appropriate
- run local Vite preview for built-output QA
- open a state gallery for boxes that visit real app routes
- visit app routes through the default browser environment
- request/import server or custom environments when supported
- edit project files safely and restore them
- edit Vite config safely and observe restarts
- wait for HMR or detect full reloads
- validate dev/build/preview parity
- inspect resolver, alias, workspace, symlink, virtual module, and URL-query
  behavior
- inspect CSS, HTML, asset, source map, public path, and generated output
  behavior
- record plugin hooks, transform output, chunk graphs, manifests, emitted
  assets, and runtime build errors
- record local performance evidence such as request count, reload time,
  invalidation breadth, transform time, and build timing
- record module graph, plugin hook, transform, server, browser, SSR, build, and
  artifact evidence
- emit machine-readable receipts for CI and AI-agent refactor loops
- generate typed autocomplete from the resolved Vite config
- emit durable receipts
- replay or inspect receipts later

The CLI should not become a second generic test runner or separate component
catalog. Its commands should stay centered on Vite environments that produce
receipts.

## Server Ownership

Async Witness should not imply that it runs a separate app server.

The app server is still Vite. Async Witness may:

- attach to an already-running Vite dev server
- inject the Async Witness Vite plugin into the user's Vite config for a run
- orchestrate Vite dev, Vite build, or Vite preview from the user's project
- use Vite 8 `server.environments` and `builder.environments` for evidence
- use Vite 8 `createBuilder(...)` for build orchestration when the project needs
  multi-environment pipeline proof
- serve the receipt replay UI as a separate local viewer

But the app under test should remain the user's actual Vite server and pipeline.

## App State Principle

`witness <selector>` exercises a selected state from the user's Vite app.

Route boxes visit real app URLs through the default browser environment:

```ts
const page = await browser.visit('/demo');
```

Visible UI state boxes use the same primitive:

```ts
box('empty cart', async ({ browser, expect, receipt }) => {
	const page = await browser.visit('/cart?state=empty');

	await expect.page.text(page, '[data-cart-count]', '0');
	await receipt.capture('empty cart');
});
```

Environment-specific boxes use the resolved environment:

```ts
const html = await environment.ssr.request('/demo');
await environment.rsc.import('/src/entry.rsc.ts');
```

Good CLI outcomes include:

- visit `/demo` through `browser`, capture DOM, screenshot, console state,
  environment name, server mode, and receipt
- open the Async Witness UI, browse named visual states, click `empty cart`, and see the
  real `/cart?state=empty` route with its receipt
- request `/dashboard` through `environment.ssr`, then hydrate through `browser`
  and verify no mismatch errors
- visit `/demo`, edit `src/message.ts`, prove the browser environment hot
  updated without reload, and write a receipt
- edit `vite.config.ts`, prove the server restarted and the expected plugin is
  active in the client environment
- build through Vite, inspect build environments and artifacts, start local
  preview, visit built output, and write a receipt
- compare dev and preview output for a route that uses CSS modules, `?url`
  assets, or generated HTML
- edit a workspace package or aliased source file and prove Vite invalidated the
  correct module exactly once
- build an SSR or worker target and prove the generated server bundle runs
  without unresolved externals or stale placeholders
- record request count, invalidated module count, reload time, or build timing
  for a large-app workflow
- run after an AI-assisted refactor and produce a receipt that says whether the
  real Vite pipeline passed, what failed, and which evidence caused the failure

Non-goals:

- catalog components in a separate Storybook-like app
- render component stories inside a synthetic Storybook-style runtime
- show screenshots without recording route, mode, environment, server, browser,
  and Vite context
- pass or fail without a receipt path
- become a browser/network mocking framework

## MVP Commands

The authoring API is specified in [Box Authoring](./box-authoring.md).

### `witness [selector]`

Run or open matching boxes from the user's project.

```sh
witness
witness hmr
witness src/Button.box.tsx
witness "scenarios/*.box.ts"
witness src/Button.box.tsx --ui
witness hmr --headed
witness hmr --watch
witness hmr --preview
witness hmr --json
witness hmr --receipt-dir .witness/receipts
```

Expected behavior:

- discover matching `*.box.ts` and `*.box.tsx` files
- load the user's Vite config and resolve environments
- generate or refresh Async Witness project types before loading boxes
- start or reuse a local Vite dev server for dev-mode runs
- expose the default browser environment alias as `browser`
- run matching boxes headlessly by default in CI
- open the Async Witness UI when `--ui` is provided or when the terminal is interactive
  and no selector is provided
- show state-gallery entries for boxes that visit browser-capable environments
- write a receipt for every run
- support `--json` for machine-readable agent and CI output
- print the receipt path for failures

Selector matching should work like a developer expects from tools such as
Vitest. A selector is not a subcommand. It can match:

- exact file path
- glob
- box name
- file basename
- tag

For example, `witness hmr` could match `scenarios/hmr.box.ts`, a box named
`hmr updates without reload`, or a box tagged `hmr`.

### `witness open`

Open the Async Witness UI on an already-running local Vite dev or preview server
without starting a box run.

```sh
witness open
witness open --url http://localhost:5173
witness open --port 5173
```

Expected behavior:

- discover or verify a local Vite dev or preview server
- open the server's `/__witness` route
- show the state gallery for boxes that visit browser-capable environments
- show resolved environments and the `browser` alias target
- discover `*.box.ts` and `*.box.tsx` files
- show box metadata and recent receipts
- explain how to enable Async Witness if the active Vite server does not expose the
  route

### `witness list`

List discovered boxes without starting a browser run.

```sh
witness list
witness list --json
```

Expected behavior:

- refresh generated Async Witness project types
- find `*.box.ts` and `*.box.tsx` files
- show box names, source files, tags, and supported modes
- show environment requirements when a box declares them
- report invalid box files with actionable errors

### `witness types`

Generate editor autocomplete types from the user's resolved Vite config.

```sh
witness types
witness types --watch
witness types --json
```

Expected behavior:

- load the user's `vite.config.*`
- resolve Vite root, config file, config dependencies, aliases, plugins, modes,
  env prefixes, server/preview/build settings, output paths, and environments
- discover the default browser environment alias target
- discover root-relative source files that are safe to edit
- include build artifact conventions such as `outDir`, `assetsDir`, and manifest
  paths
- include route surfaces when framework integrations can expose them
- write a generated ambient type file under `.witness/types`
- keep all generated literal unions permissive with a string fallback
- print actionable diagnostics when typegen cannot load config
- in `--watch`, regenerate when Vite config, config dependencies, env files, or
  box files change

Normal `witness`, `witness list`, and `witness run` should refresh these types
automatically.

### `witness run`

Explicitly run one or more boxes headlessly and write receipts.

```sh
witness run
witness run hmr
witness run scenarios/hmr.box.ts
witness run --mode dev
witness run --headed
witness run --json
witness run --receipt-dir .witness/receipts
```

Expected behavior:

- act as the explicit form of `witness [selector]`
- start or reuse a local Vite dev server when needed
- use the user's Vite config and plugin pipeline
- refresh generated Async Witness project types before loading boxes
- run matching `*.box.ts` and `*.box.tsx` boxes
- capture environment, server, HMR, DOM, screenshot, SSR, build, preview, and
  artifact evidence as applicable
- fail with a clear timeline when a box fails
- write a receipt for every run
- print a compact JSON summary when `--json` is provided, including status,
  receipt path, failed box, route, environment, mode, implicated files, and
  failure event

### `witness preview`

Test built output through a local Vite preview server.

```sh
witness preview
witness preview --run
witness preview --open
```

Expected behavior:

- ask Vite to build the app, using Vite 8 `createBuilder(...)` when appropriate
  and `build(...)` only as the simple or compatibility path
- record build environments and artifacts
- start a local Vite preview server
- expose Async Witness only on the local preview port
- expose the preview browser environment alias as `preview.browser`
- run preview-compatible boxes when `--run` is provided
- emit build and preview receipts

### `witness replay`

Open an existing receipt in the Async Witness timeline UI.

```sh
witness replay .witness/receipts/latest
witness replay .witness/receipts/2026-06-08T18-42-10Z
```

Expected behavior:

- serve the receipt viewer locally
- show the box timeline
- show environment events, stack traces, screenshots, DOM snapshots, HTML,
  console logs, network events, project edits, HMR events, and artifact checks
- avoid rerunning the box unless the user explicitly asks

### `witness doctor`

Explain whether the project is ready to run Async Witness boxes.

```sh
witness doctor
witness doctor --json
```

Expected behavior:

- verify Node, package manager, Vite version, and plugin compatibility
- verify Async Witness type generation and report stale or missing generated types
- inspect discovered boxes
- show resolved Vite environments and the `browser` alias target
- detect missing browser dependencies for browser-capable environments
- warn if `/__witness` could be exposed outside local dev or preview
- show which commands are expected to work

## Future Commands

### `witness init`

Add the smallest project setup needed for Async Witness.

This should be conservative. It may add a starter `*.box.tsx` or `*.box.ts` file
or plugin entry, but it should not create a large fixture framework.

### `witness migrate`

Help convert bespoke smoke scripts into boxes.

```sh
witness migrate scripts/hmr-smoke.ts
witness migrate scripts --dry-run
```
