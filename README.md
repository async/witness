<p align="center">
  <img src="./assets/gumbox.png" alt="Gumbox — prove changes faster, catch regressions early" width="820" />
</p>

# Gumbox

**See what your Vite pipeline actually did — with receipts.**

Restart, hard-refresh, `console.log`, pray 🙏 — Vite knew what happened the whole time, it
just never told you. Gumbox runs your real pipeline and writes a **receipt** for every run:
proof you, CI, or an AI agent can act on.

> ⚠️ **Pre-release** — not on npm yet; the [specs](./specs/README.md) are the product truth.
> Designed by Jack, implemented by **Mythos**, reviewed by **Codex**.

## A box in 30 seconds

A **box** is a small file that runs inside your real Vite pipeline and asserts what the
pipeline did, in the pipeline's own vocabulary:

```ts
import { box } from 'gumbox';

export default box('message updates without reload', async ({ browser, project, expect }) => {
	// Visit a real route — this auto-starts your real Vite dev server.
	const page = await browser.visit('/demo');

	// Edit a real source file, like a developer saving in their editor.
	const change = await project.edit('src/message.ts', {
		replace: ['before', 'after'],
	});

	// Declare what Vite should have done about it.
	await expect.edit(change, {
		client: { hmr: 'accepted' }, // hot update applied, no full reload
	});

	// Confirm the browser actually shows the new text.
	await expect.page.text(page, '#message', 'after');
});
```

```sh
gumbox hmr
```

Gumbox runs the box, restores the edited file, and writes a receipt to `.gumbox/receipts/` —
pass or fail, human- and machine-readable. If the box fails, the receipt explains _why_ in
Vite's own terms: what payload Vite sent, whether the server restarted, what the console said.

<p align="center">
  <img src="./assets/box-flow.svg" alt="you edit src/message.ts → your real Vite pipeline (dev server, HMR, SSR, build) → receipt.json: hmr accepted, 0 reloads" width="780" />
</p>

## What a box can prove

- A route renders with every asset loaded and a clean console
- An edit hot-updated, full-reloaded, or silently did nothing — per environment
- A server-only edit left the browser alone
- A config edit restarted the server with the new plugin active
- SSR renders and hydrates without console errors
- The **built** app behaves like dev (build + preview parity)
- Artifacts are right — manifest entries, no stale placeholders, no `node:fs` in worker bundles
- A workflow stayed inside a performance budget

## Why not Vitest / Playwright / Storybook?

They're great at what they own — but they see the **page**, not the **pipeline** that produced
it. That gap is how "all tests pass" and "the app is broken" happen at the same time. Gumbox
owns the pipeline: the chain from an edit to a Vite environment event to what you see, with a
receipt preserving the whole story.

## Bring your own browser

Gumbox drives a Chromium-family browser already on your machine over the Chrome DevTools
Protocol — no playwright dependency, no download at install time. Discovery order:

1. `GUMBOX_BROWSER_PATH` — explicit override. If it's set but doesn't point at an executable,
   discovery fails with an error instead of silently falling through to another browser.
2. System installs of Chrome, Edge, or Chromium, in the usual per-OS locations.
3. Playwright's browser cache as a courtesy fallback (`~/Library/Caches/ms-playwright` on
   macOS, `$XDG_CACHE_HOME` or `~/.cache/ms-playwright` on Linux,
   `%LOCALAPPDATA%\ms-playwright` on Windows) — full `chromium-<revision>` downloads only,
   newest first, the headless shell is skipped.

macOS and Linux are exercised. Windows discovery paths exist but are unverified — when
nothing is found, gumbox fails with the exact paths it checked.

**Migrating from the playwright-core era?** Gumbox used to load `playwright-core` if it was
present. Now it finds your browser directly, and if you only have playwright's downloaded
Chromium, the cache fallback still picks it up. If discovery fails, set `GUMBOX_BROWSER_PATH`
or install Chrome.

## Docs

- **[Specs](./specs/README.md)** — product direction and the source of truth

The website is being worked on at [gum.tools](https://gum.tools).

## Status

Built in slices. Box authoring, dev/build/preview runs, browser evidence, the CLI, and JSON
receipts work today. The state-gallery UI, generated types, and receipt replay are coming.

## Contributing

The workspace runs on **Deno** (the library itself is runtime-agnostic — it runs wherever Vite
runs):

```sh
deno install        # install dependencies
deno task test      # run the test suite (drives real Vite pipelines)
deno task check     # format check + lint + typecheck
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full setup. Start with
[`specs/`](./specs/README.md) for intent, and `.ruler/` for the working agreements.
