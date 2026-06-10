# Gumbox

**See what your Vite pipeline is actually doing — and keep the receipts.**

You save a file and the page stays stale. You restart the dev server and now it works — this
time. It worked in dev, then 404'd in production. Every Vite developer knows the ritual:
restart, hard-refresh, `console.log`, pray 🙏.

Vite knew exactly what happened the whole time. It just never told you.

Gumbox makes it tell you. Describe what your pipeline should do, and Gumbox runs the real
thing — your config, your plugins, your environments — and proves what it actually did. Every
run writes a **receipt**: evidence you, CI, or an AI agent can act on.

> ⚠️ **Pre-release.** Gumbox is under active development and not yet published to npm. The API
> below follows the [specs](./specs/README.md), which are the product truth — some pieces are
> still landing (see [What works today](#what-works-today)).
>
> This project is designed by Jack, implemented by **Mythos**, with **Codex** serving as its reviewer.

## The problem: your Vite pipeline is a black box

Every Vite developer knows these moments:

- You save a file and the page full-reloads (or worse, silently stays stale) — and nothing tells
  you which module or plugin caused it.
- It works in dev and breaks in `build`/`preview` — wrong CSS order, an empty `import.meta.glob`,
  an env var that's suddenly `undefined`.
- The build "succeeded" but the manifest is missing an entry, a hashed asset 404s after deploy,
  or `node:fs` leaked into your worker bundle.
- You edit one server file and the browser nukes all your form state — was the SSR environment
  supposed to invalidate the client?
- A hydration mismatch warning shows you DOM nodes, not the module that produced them.
- Build time quietly tripled three upgrades ago and nobody has evidence of when.

The state of the art for all of this is reading `--debug` text logs, running
`vite build && vite preview` and clicking around, or writing a bespoke smoke script that starts
a server, curls a route, greps output, and leaves no evidence behind. Vite's own repo hand-rolls
exactly such a harness for its tests. Meanwhile your test tools can't help: Vitest and
Playwright can see the **page**, but not the **pipeline** that produced it — which is how
"all tests pass" and "the app is broken" happen at the same time.

Gumbox turns each of those pipeline questions into a small file called a **box**. A box runs
inside your real Vite pipeline — your config, your plugins, your environments — and asserts
what the pipeline did, in the pipeline's own vocabulary:

```ts
import { box } from 'gumbox';

export default box('message updates without reload', async ({ browser, project, expect }) => {
	// 1. Visit a real route through your real Vite dev server.
	const page = await browser.visit('/demo');

	// 2. Edit a real source file, like a developer saving in their editor.
	const change = await project.edit('src/message.ts', {
		replace: ['before', 'after'],
	});

	// 3. Declare what Vite should have done about it.
	await expect.edit(change, {
		client: { hmr: 'accepted' }, // hot update applied, no full reload
	});

	// 4. Confirm the browser actually shows the new text.
	await expect.page.text(page, '#message', 'after');
});
```

Run it:

```sh
gumbox hmr
```

Gumbox starts your dev server (your `vite.config.*`, your plugins), runs the box, restores the
edited file, and writes a receipt to `.gumbox/receipts/`. If the box fails, the receipt explains
_why_ in Vite's own terms — which file changed, what HMR payload Vite sent, whether the server
restarted, what the browser console said.

HMR is just one receipt class. The same box shape answers the rest of the list above:

| Question                                                           | Recipe below                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Does the route render, with assets loading and a clean console?    | ["Does this route actually work?"](#does-this-route-actually-work)                                                 |
| Did my edit hot-update, full-reload, or silently do nothing?       | ["Does HMR still work?"](#does-hmr-still-work)                                                                     |
| Did a server-only edit leave the browser alone?                    | ["Does a server-only edit leave the browser alone?"](#does-a-server-only-edit-leave-the-browser-alone)             |
| Did the config edit restart the server with the new plugin active? | ["Does editing vite.config restart the server…"](#does-editing-viteconfig-restart-the-server-with-the-new-plugin)  |
| Does SSR render and hydrate without console errors?                | ["Does SSR render and hydrate cleanly?"](#does-ssr-render-and-hydrate-cleanly)                                     |
| Does the **built** app behave like dev?                            | ["Does the BUILT app still work?"](#does-the-built-app-still-work-devbuildpreview-parity)                          |
| Are the artifacts right — manifest, chunks, no stale placeholders? | ["Did my refactor leave Node-only code…"](#did-my-refactor-leave-node-only-code-in-the-worker-bundle-agent-oracle) |
| Did this workflow stay inside a performance budget?                | ["How slow is this, really?"](#how-slow-is-this-really-performance-receipts)                                       |

## Core ideas (read this first)

If you remember nothing else, remember these four words:

| Word            | Meaning                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **Box**         | A small async function describing one Vite pipeline scenario. Lives in a `*.box.ts(x)` file.      |
| **Environment** | A named part of your Vite pipeline (`client`, `ssr`, `rsc`, …). Names come from _your_ config.    |
| **Edit**        | A real, reversible file change Gumbox saves to disk so Vite reacts exactly like it would for you. |
| **Receipt**     | The evidence file every run writes: what happened, in order, machine- and human-readable.         |

And one product rule that explains everything else:

> A box runs inside **your** real Vite pipeline, exercises one or more Vite environments, and
> writes a receipt explaining what happened.

Gumbox never builds its own bundler, fakes HMR, or renders your components in a synthetic
catalog app. If your pipeline is broken, the box fails. If your pipeline works, you have proof.

## Quick start

### 1. Write your first box

Create a file ending in `.box.ts` (or `.box.tsx`) anywhere in your project:

```ts
// scenarios/dashboard.box.ts
import { box } from 'gumbox';

export default box('dashboard route works', async ({ browser, expect, receipt }) => {
	// No setup needed — visiting a route auto-starts your Vite dev server.
	const page = await browser.visit('/dashboard');

	await expect.page.text(page, 'h1', 'Dashboard');
	await expect.page.outcome(page, { consoleErrors: 0 });
	await receipt.capture('dashboard visited');
});
```

That's a complete, useful box: it proves the route renders through your real dev server with a
clean console, and it captures a labeled checkpoint into the receipt.

### 2. Run it

```sh
gumbox                       # run every box in the project
gumbox dashboard             # run boxes matching "dashboard"
gumbox scenarios/dashboard.box.ts
gumbox list                  # see what Gumbox discovered without running anything
```

Selectors work like you'd expect from Vitest: a file path, a glob, a box name, a file basename,
or a tag all match.

### 3. Read the result

```
pass dashboard route works (scenarios/dashboard.box.ts)
1 passed, 0 failed (1 boxes)
receipt: .gumbox/receipts/2026-06-10T18-42-10Z/receipt.json
```

Every run — pass or fail — writes a receipt. On failure, the receipt path is your starting
point: it records the route, the environment, the Vite events, console errors, failed requests,
file edits, and which assertion broke.

## The box context

Every box receives exactly six tools. You destructure the ones you need:

```ts
box('name', async ({ environment, browser, project, pipeline, expect, receipt }) => { ... });
```

| Key           | What it is                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `environment` | Your resolved Vite environments by name: `environment.client`, `environment.ssr`, …                        |
| `browser`     | Shorthand for the default browser-capable environment. `browser.visit('/route')`.                          |
| `project`     | Real file operations: `project.edit(...)`, `project.read(...)`, `project.exists(...)`.                     |
| `pipeline`    | Explicit lifecycle control: `pipeline.dev()`, `pipeline.build()`, `pipeline.preview()`.                    |
| `expect`      | All assertions. Failing assertions fail the box and are recorded in the receipt.                           |
| `receipt`     | Named checkpoints and notes: `receipt.capture(label)`, `receipt.note(text)`, `receipt.measure(label, fn)`. |

### `environment` — talk to your Vite environments

Environment names come from your Vite config, not from Gumbox. A plain app has `client` and
`ssr`, while a framework project might add `rsc`, `edge`, or `worker`. Each environment only
exposes what it can actually do:

```ts
const page = await environment.client.visit('/demo'); // browser-capable: open a real page
const html = await environment.ssr.request('/demo'); // fetchable: get the response body
const mod = await environment.ssr.import('/src/entry.ts'); // runnable: import a module

// fetch() keeps the whole response as evidence instead of throwing on non-OK:
const response = await environment.client.fetch('/api/health');
await expect.response.matches(response, { status: 200, contentType: 'application/json' });
```

`browser` is just an alias for your default browser-capable environment — in a normal app,
`browser === environment.client`. The receipt records which environment the alias pointed at.

### `project` — edit real files, safely

`project.edit` writes to disk the way your editor would, so Vite's file watcher reacts for
real. Gumbox restores every edited file when the box finishes (and marks the receipt if a
restore fails). Paths are relative to your Vite root.

```ts
// Replace text (the most common form):
const change = await project.edit('src/message.ts', { replace: ['before', 'after'] });

// Transform with a function:
await project.edit('src/message.ts', (code) => code.replace('before', 'after'));

// Create, remove, copy:
await project.edit.create('src/new-style.css', '.message { color: green; }');
await project.edit.remove('src/old-style.css');
await project.edit.copy('src/message.ts', 'edits/message.after.ts');

// Edit your vite.config.* (Gumbox finds it for you):
const configChange = await project.edit.config({ replace: ['oldPlugin()', 'newPlugin()'] });

// Read project state:
const manifest = await project.read('dist/manifest.json');
const built = await project.exists('dist/client/index.html');
```

Every edit returns a **change receipt** — the handle you pass to `expect.edit` to ask "what did
Vite do about this?"

### `pipeline` — control dev, build, and preview

For simple boxes you never touch this: `browser.visit()` auto-starts the dev server. Reach for
`pipeline` when the lifecycle _is_ the thing you're testing:

```ts
await pipeline.dev(); // start the dev server explicitly
const build = await pipeline.build(); // run your real Vite build
const preview = await pipeline.preview(build); // serve the built output locally

const page = await preview.browser.visit('/dashboard'); // visit the BUILT app
```

All three accept a config overlay when you need to tweak config for one run without editing
files:

```ts
await pipeline.dev({
	config(config) {
		return { ...config, define: { ...config.define, __VARIANT__: JSON.stringify('debug') } };
	},
});
```

Use `project.edit.config(...)` instead when the point of the box is proving that a _config file
edit_ causes a restart.

### `expect` — assertions are partial receipts

Gumbox has one assertion philosophy worth understanding, because it makes everything
predictable:

> **You declare the outcome you expect as plain data, in the same vocabulary the receipt
> records.** Gumbox waits for things to settle, diffs your expectation against the evidence, and
> reports every mismatch at once.

There are no method names to memorize like `hotUpdate()` or `noFullReload()` — you write the
receipt you want, and Gumbox tells you how reality differed.

#### `expect.edit(change, expectation)` — the one edit/HMR assertion

One call describes the whole expected reaction to one edit, across every environment you care
about:

```ts
const change = await project.edit('src/message.ts', { replace: ['before', 'after'] });

await expect.edit(change, {
	client: {
		hmr: 'accepted', // hot update applied, no full reload
		invalidated: ['/src/message.ts'], // these modules must be among the invalidated
	},
	ssr: { invalidated: [] }, // SSR must NOT have been touched
});
```

The vocabulary, field by field:

| Field         | Values                                    | Meaning                                                                                                 |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `hmr`         | `'accepted'` / `'full-reload'` / `'none'` | How the environment reacted: hot update applied / reloaded entirely / saw the change, did nothing.      |
| `invalidated` | `string[]`                                | Module paths that must be among the invalidated modules (suffix match). `[]` = nothing invalidated.     |
| `messages`    | `string[]`                                | Framework hot-channel messages that must have been broadcast (e.g. `'qwik:hmr'`).                       |
| `error`       | object                                    | Expected error evidence. **Omitting it means "no error allowed"** — naming an environment fails closed. |

Rules that keep it predictable:

- **Omitted field** → don't care.
- **Omitted environment** → not asserted (but still recorded in the receipt).
- **Named environment** → implies `error: null`. Expecting an error is explicit:
  `error: { plugin: 'debug-plugin' }`.
- The reserved top-level `server` key asserts the dev-server reaction, so config and env-file
  edits use the same call:

```ts
const change = await project.edit.config({ replace: ['oldPlugin()', 'newPlugin()'] });

await expect.edit(change, { server: 'restarted' });
```

- Escape hatch: an environment value may be a predicate
  `(outcome) => boolean` for evidence the vocabulary can't express yet. Treat it as advanced.

#### `expect.page.*` — DOM waits plus one outcome check

The fluent methods are genuine "wait until X" operations against a page you got from
`visit(...)`:

```ts
await expect.page.text(page, '#message', 'after'); // trimmed text equals
await expect.page.exists(page, '[data-cart-count]'); // selector matches
await expect.page.visible(page, 'dialog'); // matches AND visible
await expect.page.computedStyle(page, 'h1', { color: 'rgb(0, 128, 0)' });
await expect.page.attribute(page, 'p', 'data-state', 'ready');
await expect.page.attribute(page, 'button', 'disabled', null); // null = attribute absent
await expect.page.bodyText(page, { contains: 'after' });
await expect.page.bodyText(page, { notContains: 'before' });
```

Note the pattern: **negation is always an option value** (`null`, `notContains`), never a
method name. You'll never hunt for a `notX()` method.

Recorded page health is one declarative check, mirroring the receipt's page record:

```ts
await page.trackEvents('my-app:hydrated'); // start tracking BEFORE you act

// ... visit, edit, click ...

await expect.page.outcome(page, {
	navigations: 0, // the page never reloaded after initial load
	consoleErrors: 0, // console errors + uncaught page errors
	failedRequests: 0, // failed network requests
	events: { 'my-app:hydrated': { atLeast: 1 } },
});
```

Numeric fields are exact counts, and omitted fields aren't checked. When a framework fires the same
event name for unrelated reasons, scope the count with
`events: { name: { atLeast: 1, detailIncludes: '"label":"even"' } }`.

#### Build, artifact, and response assertions

```ts
const build = await pipeline.build();

await expect.build.environment(build, 'client'); // this environment was built
await expect.build.artifact(build, 'dist/client/index.html'); // this file was emitted

await expect.artifact.exists(build, 'dist/client/assets');
await expect.artifact.text(build, 'dist/server/entry.js', {
	notContains: '__VITE_ASSETS_MANIFEST__', // stale placeholder check
});
await expect.artifact.json(build, 'dist/client/.vite/manifest.json', (json) => {
	return Object.keys(json).length > 0;
});

const html = await environment.ssr.request('/');
await expect.html.contains(html, '<main');
```

All `expect.*` waits are bounded — pass `{ timeoutMs }` as the last argument to adjust one
assertion.

### `receipt` — name the moments that matter

Receipts are automatic. The `receipt` API just lets you add human landmarks:

```ts
await receipt.capture('after config restart'); // named checkpoint (with page evidence when available)
receipt.note('Verified debug plugin is active.'); // free-text note in the timeline

const load = await receipt.measure('reload large route', async () => {
	await page.reload();
});
// load.durationMs is yours to assert on or just record
```

## Recipes

Real boxes for the questions Vite developers actually ask. Each one is copy-paste-adaptable.

### "Does this route actually work?"

The simplest useful box: prove a route renders through your real dev server, every asset the
page asked for actually loaded, and the console is clean. This is the receipt class for
"missing asset / 404 after deploy / silent console error" pains.

```ts
import { box } from 'gumbox';

export default box('dashboard renders with all assets', async ({ browser, expect, receipt }) => {
	const page = await browser.visit('/dashboard');

	await expect.page.visible(page, 'h1');
	await expect.page.outcome(page, {
		consoleErrors: 0, // no console errors or uncaught page errors
		failedRequests: 0, // every script, style, image, and font loaded
	});
	await receipt.capture('dashboard rendered');
});
```

### "Does HMR still work?"

```ts
import { box } from 'gumbox';

export default box('message updates without reload', async ({ browser, project, expect }) => {
	const page = await browser.visit('/demo');

	const change = await project.edit('src/message.ts', {
		replace: ['before', 'after'],
	});

	await expect.edit(change, { client: { hmr: 'accepted' } });
	await expect.page.text(page, '#message', 'after');
});
```

### "Does a server-only edit leave the browser alone?"

```ts
import { box } from 'gumbox';

export default box(
	'server edit does not reload browser',
	async ({ environment, project, expect }) => {
		await environment.ssr.request('/dashboard');

		const change = await project.edit('src/server-only.ts', {
			replace: ['before', 'after'],
		});

		await expect.edit(change, {
			ssr: { invalidated: ['/src/server-only.ts'] },
			client: { hmr: 'none', invalidated: [] },
		});
	},
);
```

### "Does editing vite.config restart the server with the new plugin?"

```ts
import { box } from 'gumbox';

export default box(
	'config change reloads the plugin pipeline',
	async ({ browser, project, expect }) => {
		await browser.visit('/demo');

		const change = await project.edit.config({
			replace: ['debugPlugin({ enabled: false })', 'debugPlugin({ enabled: true })'],
		});

		await expect.edit(change, { server: 'restarted' });

		const page = await browser.visit('/demo');
		await expect.page.exists(page, '[data-debug-plugin]');
	},
);
```

### "Does SSR render and hydrate cleanly?"

```ts
import { box } from 'gumbox';

export default box('home SSR hydrates cleanly', async ({ environment, browser, expect }) => {
	const html = await environment.ssr.request('/');
	await expect.html.contains(html, '<main');

	const page = await browser.visit('/');
	await expect.page.visible(page, 'main');
	await expect.page.outcome(page, { consoleErrors: 0 });
});
```

### "Does the BUILT app still work?" (dev/build/preview parity)

```ts
import { box } from 'gumbox';

export default box(
	{ name: 'built app serves dashboard', tags: ['preview'], modes: ['preview'] },
	async ({ pipeline, expect, receipt }) => {
		const build = await pipeline.build();
		await expect.build.artifact(build, 'dist/client/index.html');

		const preview = await pipeline.preview(build);
		const page = await preview.browser.visit('/dashboard');

		await expect.page.text(page, 'h1', 'Dashboard');
		await expect.page.outcome(page, { consoleErrors: 0 });
		await receipt.capture('preview dashboard state');
	},
);
```

Run it with `gumbox preview` (or `gumbox --mode preview`).

### "Did my refactor leave Node-only code in the worker bundle?" (agent oracle)

```ts
import { box } from 'gumbox';

export default box('worker build has no node assumptions', async ({ pipeline, expect }) => {
	const build = await pipeline.build();

	await expect.artifact.text(build, 'dist/worker/index.js', { notContains: 'node:fs' });
	await expect.artifact.text(build, 'dist/worker/index.js', { notContains: 'process.cwd' });

	const preview = await pipeline.preview(build);
	const page = await preview.browser.visit('/dashboard');

	await expect.page.outcome(page, { consoleErrors: 0 });
	await expect.page.text(page, 'h1', 'Dashboard');
});
```

This is the box you run after an AI-assisted refactor: "typecheck passed" and "the real Vite
pipeline works" are different facts, and the receipt proves the second one.

### "How slow is this, really?" (performance receipts)

Performance regressions go unnoticed because nobody keeps evidence. `receipt.measure` records
a labeled duration into every run's receipt, so "build time tripled three upgrades ago" becomes
a diffable fact instead of a vibe:

```ts
import { box } from 'gumbox';

export default box('large route reload budget', async ({ browser, receipt }) => {
	const page = await browser.visit('/large-app');

	const load = await receipt.measure('reload large route', async () => {
		await page.reload();
	});
	receipt.note(`reload took ${load.durationMs}ms`);

	// Enforce a local budget: a thrown error fails the box and lands in the receipt.
	if (load.durationMs > 500) {
		throw new Error(`reload took ${load.durationMs}ms, budget is 500ms`);
	}
});
```

Declarative `expect.performance.*` budgets (duration, request counts, invalidation breadth) are
specced for a later slice — `receipt.measure` works today.

### "Show me a UI state" (the visual-state pattern)

A visible UI state is just a box that reaches the state through a real route:

```ts
import { box } from 'gumbox';

export default box(
	{ name: 'empty cart', tags: ['ui', 'cart'], ui: true },
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit('/cart?state=empty');

		await expect.page.text(page, '[data-cart-count]', '0');
		await receipt.capture('empty cart');
	},
);
```

`ui: true` marks the box for the state gallery (UI ships in a later slice). There's no args
model, no story file, no separate catalog app — the state is your app, on a real route, with a
receipt.

## Box files and options

- Box files end in `.box.ts` or `.box.tsx` and are discovered anywhere under your Vite root.
- `export default box(...)` is the common case, and named exports are fine when one file groups
  related scenarios.
- The options form takes small, receipt-oriented metadata:

```ts
box(
	{
		name: 'preview build visits dashboard',
		tags: ['preview', 'build'], // selectable via `gumbox <tag>`
		modes: ['preview'], // which modes this box supports (default: dev)
		ui: true, // show in the state gallery
	},
	async (ctx) => {
		/* ... */
	},
);
```

## CLI

```sh
gumbox [selector] [options]      # run matching boxes headlessly
gumbox run [selector] [options]  # explicit form of the same
gumbox list [--json]             # list discovered boxes without running them
gumbox preview [--run]           # build, then run preview-mode boxes against built output
```

| Option                | Effect                                                           |
| --------------------- | ---------------------------------------------------------------- |
| `--json`              | machine-readable output for CI and agents                        |
| `--receipt-dir <dir>` | write receipts under `<dir>` (default `.gumbox/receipts`)        |
| `--mode <mode>`       | only run boxes that declare `<mode>` (`dev`, `preview`, …)       |
| `--preview`           | shorthand for `--mode preview`                                   |
| `--headed`            | run browser sessions with a visible window (great for debugging) |

Exit codes: `0` all boxes passed · `1` a box failed (receipt path is printed) · `2` usage,
selector, discovery, or pipeline setup error.

`--json` output is built for automation — status, receipt path, pass/fail counts, and the
failed boxes with their error messages — so a CI job or an agent loop can branch on it without
parsing prose.

## Receipts

Every run writes a receipt directory under `.gumbox/receipts/`. The receipt records, in order:

- the box file, export, and resolved Vite config facts
- environment names and which one the `browser` alias resolved to
- dev/build/preview lifecycle events and server URLs
- every project edit, its before/after diff, and whether restoration succeeded
- per-environment reactions to each edit: HMR payloads, invalidated modules, restarts, errors,
  framework hot-channel messages
- page evidence: navigations, console errors, failed requests, tracked DOM events, captures
- build artifacts and assertion results — passed _and_ failed

Treat receipts as generated output: read them, link them in PRs, feed them to agents — but
never hand-edit them. When a box fails, start at the printed receipt path — it usually answers
"what did Vite actually do?" before you reach for a debugger.

## What Gumbox is **not**

Knowing the boundaries saves you from using the wrong tool:

| If you want…                                                                                       | Use…                |
| -------------------------------------------------------------------------------------------------- | ------------------- |
| A component catalog with args/controls                                                             | Storybook           |
| Browser-run unit tests with locators and mocking                                                   | Vitest Browser Mode |
| Cross-page user-flow automation                                                                    | Playwright          |
| Proof that **your Vite pipeline** (dev, HMR, SSR, environments, build, preview, artifacts) behaves | **Gumbox**          |

The non-overlap is causality: Playwright can see the page, but only Gumbox connects it back to
the chain of Vite events that produced it (`edit → environment hot-updated → SSR untouched →
DOM changed without reload → receipt`).

## What works today

Gumbox is built in slices. Implemented and tested now:

- `box(...)` authoring, discovery of `*.box.ts(x)`, named exports, tags/modes/ui metadata
- the six-key context: `environment`, `browser`, `project`, `pipeline`, `expect`, `receipt`
- real dev server runs, project/config/env edits with restore, restart evidence
- browser visits with page evidence (console, network, navigations, tracked events)
- `pipeline.build()` / `pipeline.preview()` with artifact assertions
- the CLI: `gumbox [selector]`, `run`, `list`, `preview`, with `--json`, `--mode`,
  `--receipt-dir`, `--headed`
- JSON receipts for every run

Coming in later slices (the CLI will tell you, too): `gumbox open` and the state-gallery UI,
`gumbox types` (autocomplete generated from your resolved Vite config), `gumbox replay`
(receipt timeline viewer), `gumbox doctor`, `--watch`, and `gumbox init`/`migrate`.

See [`specs/`](./specs/README.md) for the full product direction — the specs are the source of
truth when docs and code disagree.

## Contributing

The workspace runs on **Deno** (the library itself is runtime-agnostic — it runs wherever Vite
runs):

```sh
deno install        # install dependencies
deno task test      # run the test suite (drives real Vite pipelines)
deno task check     # format check + lint + typecheck
deno task build     # build dist/
```

Start with [`specs/`](./specs/README.md) to understand intent, and `.claude/rules/` for the
working agreements (runtime-agnostic tooling, TDD, generated-output boundaries).
