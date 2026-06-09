# Guidance Source Of Truth Rule

In this repo, committed AI guidance lives directly in `.claude/rules/*.md`. There is no `.ruler`
source tree here; edit these rule files by hand and commit them.

## Source Layout

- Put durable, always-on policy in `.claude/rules/<rule-name>.md`.
- Keep each rule focused on one concern (tooling, quality, testing, security, boundaries).
- Specs in `specs/` are product truth; rules describe how to work, not what to build.

## Guidance Freshness

When current source contradicts loaded guidance, update the narrowest rule file that was wrong.
Prefer replacing stale text over appending another long note. Do not encode one-off branch facts,
temporary debugging notes, or speculative design as durable guidance. Do not copy rules from other
repos without stripping references that do not apply here.
