---
name: writing-boxes
description: Author gumbox boxes correctly — the box() overloads, name derivation, the six-key context, the declarative expect.edit vocabulary, and the recipes for HMR, SSR isolation, config restarts, build/preview parity, and UI states. Use when writing or reviewing *.box.ts files, replacing smoke scripts with boxes, or asserting on Vite pipeline behavior.
---

# Writing Boxes

A box is a TypeScript file that runs inside the project's real Vite pipeline and writes a
receipt proving what happened. This skill covers authoring them correctly.

## File shape

- Files end in `.box.ts` or `.box.tsx`, discovered anywhere under the Vite root (folders like
  `boxes/` for pipeline QA, colocated for UI states — both work).
- `export default box(...)` is the common case; named exports group related scenarios.

## The box() overloads

```ts
box(run);                      // anonymous — name derives from the file
box('name', run);              // explicit name
box({ name?, tags?, modes?, ui? }, run);
```

Name derivation (explicit always wins): default export of `cart.box.ts` → `cart`; named export
`full` → `cart: full`; derived collisions upgrade to relative paths (`scenarios/cart`).
For pipeline boxes, prefer descriptive explicit names — the receipt prints them back as
one-line specs. `modes` defaults to `['dev']`; build/preview boxes must declare their mode.

## The six-key context

```ts
box('name', async ({ environment, browser, project, pipeline, expect, receipt }) => { ... });
```

- `environment.<name>` — the project's resolved Vite environments: `.request(path)`,
  `.fetch(path)` (never throws; assert with `expect.response.matches`), `.import(id)`,
  `.visit(path)` on browser-capable ones.
- `browser` — alias for the default browser environment; `browser.visit('/')` auto-starts dev.
- `project` — real file edits with guaranteed restore: `project.edit(path, { replace: [a, b] })`,
  `.edit.create/remove/copy`, `.edit.config(change)`, `.read`, `.exists`. Every edit returns a
  change receipt for `expect.edit`.
- `pipeline` — explicit lifecycle: `dev()`, `build()`, `preview(build)`; all accept a
  `config(inline) => inline` overlay (use overlays for one-run tweaks, `project.edit.config`
  when the box proves a config-file edit).
- `expect` — all assertions (below).
- `receipt` — `capture(label)`, `note(text)`, `measure(label, fn)`.

## expect.edit — the only edit/HMR assertion

An assertion is a partial receipt: declare the expected outcome as data, in the receipt's own
vocabulary. Never invent method-grammar assertions (`hotUpdate()`, `noFullReload()` were
deliberately removed).

```ts
await expect.edit(
	change,
	{
		client: { hmr: 'accepted', invalidated: ['/src/message.ts'], messages: ['qwik:hmr'] },
		ssr: { invalidated: [] },
		server: 'restarted', // reserved key: config/env-file edits
	},
	{ timeoutMs: 15_000 },
);
```

- `hmr`: `'accepted' | 'full-reload' | 'none'` — omitted means don't care.
- `invalidated`: suffix-matched module paths; `[]` asserts nothing invalidated.
- `messages`: framework hot-channel broadcasts that must arrive.
- Naming an environment fails closed on errors; expecting one is explicit:
  `error: { plugin: 'x' }`.
- Escape hatch: an environment value may be a predicate `(outcome) => boolean` — advanced only.

## Page and build assertions

```ts
await expect.page.text(page, '#message', 'after');
await expect.page.bodyText(page, { contains: 'a', notContains: 'b' });
await expect.page.attribute(page, 'button', 'disabled', null); // null = absent
await page.trackEvents('qHmr'); // BEFORE the action
await expect.page.outcome(page, {
	navigations: 0,
	consoleErrors: 0,
	failedRequests: 0,
	events: { qHmr: { atLeast: 1, detailIncludes: '"x"' } },
});

const build = await pipeline.build();
await expect.build.artifact(build, 'dist/client/index.html');
await expect.build.forbids(build, ['node:fs', 'import.meta.hot.accept(']);
await expect.artifact.text(build, 'dist/server/entry.js', { notContains: '__PLACEHOLDER__' });
await expect.artifact.json(build, 'dist/client/.vite/manifest.json', (json) => !!json);
```

Negation is always an option value (`null`, `notContains`, `invalidated: []`), never a method
name. All waits are bounded and event-driven; pass `{ timeoutMs }` to adjust one assertion.

## Rules that reviews enforce

- Drive the real Vite pipeline; never mock it.
- No sleeps — waits resolve on evidence events or page conditions.
- If you add an assertion, prove it can fail (deliberate-failure boxes exist for this).
- Boxes never import app code paths that don't exist; run `gumbox <selector>` to verify, and
  read the printed receipt when anything surprises you.
