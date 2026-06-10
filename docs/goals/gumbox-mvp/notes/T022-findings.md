# T022 — Declarative Assertion Redesign

User directive 2026-06-10: `customPayload`, `noFullReload`, `noNavigations`
were unpredictable and weird. Design rule now encoded in
`specs/box-authoring.md` (commit 369a8de): **an assertion is a partial
receipt** — authors declare the expected outcome as data in the receipt's own
vocabulary, gumbox diffs expectation against evidence.

## API before/after (qwik-bundler nitro-hmr box)

Before (6 awaited method calls, 3 naming conventions, Vite wire-format jargon):

```ts
await expect.environment.client.customPayload(change, 'qwik:hmr', WAIT);
await expect.environment.client.noFullReload(change, WAIT);
await expect.environment.client.notInvalidated(change, WAIT);
await expect.environment.ssr.invalidated(change, 'src/home.tsx', WAIT);
await expect.environment.ssr.satisfies(
	change,
	(outcome) => outcome.fullReload && !outcome.restart && outcome.error === null,
	WAIT,
);
await expect.environment.nitro.notInvalidated(change, WAIT);
```

After (one declarative expectation; the three-way divergence is readable as a
table):

```ts
await expect.edit(
	change,
	{
		client: { hmr: 'none', invalidated: [], messages: ['qwik:hmr'] },
		ssr: { hmr: 'full-reload', invalidated: ['src/home.tsx'] },
		nitro: { invalidated: [] },
	},
	WAIT,
);
```

Page health checks collapsed the same way: `cleanConsole` / `noNavigations` /
`noFailedRequests` / `event` became one `expect.page.outcome(page, {
navigations: 0, consoleErrors: 0, failedRequests: 0, events: { qHmr: {
atLeast: 1 } } })`. DOM waits stay fluent; negation is always an option value
(`attribute(page, sel, name, null)` = absent, `bodyText({ notContains })`).

## Failure output example (from the falsifiability test)

```text
the reaction to editing src/message.ts did not match the expectation:
  - client.hmr: expected 'full-reload', observed 'accepted'
  - client.invalidated: expected no invalidated modules, observed: /src/message.ts
  - ssr.hmr: expected 'accepted', observed 'none'
Receipt: <run>/receipt.json
```

All mismatches across all environments arrive in one report; the assertion
record in the receipt carries structured `expected` and `observed` objects.

## Receipt vocabulary changes

- `EnvironmentEditOutcome.hmr: 'accepted' | 'full-reload' | 'none'` is the
  headline classification (replaces the `update`/`fullReload` boolean pair).
- `customPayloads` → `messages` (`{ name, data? }`): "the framework broadcast
  its own HMR message", not Vite's `type: 'custom'` wire format.

## Implementation notes

- Real race found by the qwik boxes: an environment can settle (hook seen,
  nothing invalidated) *before* the framework broadcasts its hot messages.
  An expectation naming `messages` now extends the wait event-driven until
  the named messages arrive or the deadline passes — the old `customPayload`
  wait semantics, preserved declaratively.
- `server: 'restarted'` (reserved key) absorbs `expect.pipeline.serverRestarted`
  including its wait-for-listening-again teardown guard.
- A framework-protocol HMR reaction reads as `hmr: 'none'` + `messages`.
  Consider a future fourth classification (for example `'framework'`) if
  `'none'`-plus-messages confuses readers; deferred pending user feedback.
- Removed outright (0.0.0, no deprecation aliases): the per-environment proxy
  namespace, `expect.browser`, `expect.pipeline`, `hotUpdate`, `customPayload`,
  `noFullReload`, `invalidated`, `notInvalidated`, `satisfies`, `page.event`,
  `page.noNavigations`, `page.noFailedRequests`, `page.cleanConsole`,
  `page.containsText`, `page.notContainsText`, `page.noAttribute`.
