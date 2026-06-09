# gumbox

`@gumbox/vite` — boxes that run inside a real Vite pipeline and write receipts, replacing brittle
local smoke scripts. Specs in `specs/` are product truth.

## Workspace

- Runtime/toolchain is **Deno**: `deno task test`, `deno task build`, `deno task check`,
  `deno install`. Do not use pnpm/npm commands.
- `package.json` exists for npm publishing metadata only.

## Hard Tooling Rules (see `.claude/rules/runtime-agnostic-tooling.md`)

- Library and test code is runtime-agnostic: no `node:*` imports except `node:fs/promises`, no
  `process.*`, no `Deno.*`/`Bun.*`.
- Use `pathe` (paths), `ufo` (URLs), `mlly` (fileURLToPath/module utils), `std-env` (runtime
  detection), `tinyglobby` (globbing), global `fetch`.
- AST work uses rolldown/oxc's native parser (`parseAst` from `rolldown` / `oxc-parser`) — never
  babel, acorn, or a second JS parser. Prefer native (Rust-backed) tooling with TypeScript APIs and
  the unjs ecosystem.

All rules in `.claude/rules/*.md` apply; they are hand-edited committed source.
