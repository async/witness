# Async Witness

`@async/witness` — boxes that run inside a real Vite pipeline and write receipts, replacing brittle
local smoke scripts. Specs in `specs/` are product truth.

## Workspace

- Runtime/toolchain is **pnpm on Node**: `pnpm install`, `pnpm run test`, `pnpm run build`,
  `pnpm run check`.
- `package.json` is the canonical workspace/package manifest. Keep `pnpm-lock.yaml` in sync with
  dependency changes so local `pnpm publish` and CI use the same graph.

## Hard Tooling Rules (see `.ruler/runtime-agnostic-tooling.md`)

- Library and ordinary test code is runtime-agnostic: no `node:*` imports, no `process.*`, no
  `Deno.*`/`Bun.*`. Filesystem access is an injected `WitnessFileSystem`; only explicit host
  boundaries adapt runtime filesystem APIs.
- Use `pathe` (paths), `ufo` (URLs), `src/file-url.ts` (file URL <-> path), `std-env` (runtime
  detection), `tinyglobby` (globbing), global `fetch`.
- AST work uses rolldown/oxc's native parser (`parseAst` from `rolldown` / `oxc-parser`) — never
  babel, acorn, or a second JS parser. Prefer native (Rust-backed) tooling with TypeScript APIs and
  the unjs ecosystem.

All rules in `.ruler/*.md` apply; they are hand-edited committed source. Run
`pnpm dlx @intellectronica/ruler apply` after editing them to regenerate the agent files
(`CLAUDE.md`, `AGENTS.md`, `.claude/`, …) — never hand-edit the generated outputs.
