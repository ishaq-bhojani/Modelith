# CLAUDE.md

Project guidance for Claude Code working in **Modelith**.

**Start with [`AGENTS.md`](AGENTS.md)** — it is the canonical agent orientation
(golden rules, commands, the three-process architecture, conventions, gotchas,
and where to look). Everything there applies here. This file only adds
Claude-Code-specific notes so the two never drift.

## Claude-specific rules

- **Do NOT add a `Co-Authored-By: Claude` trailer to commit messages** in this
  repo. The maintainer launches Modelith from their personal GitHub and does not
  want the trailer in the public history.
- **Commit/push only when asked.** If work starts on `master`, branch first
  (`feat/…`, `fix/…`, `docs/…`). `master` is the default branch (there is no
  `main`).
- **Releases:** a version tag (`vX.Y.Z`) triggers `.github/workflows/release.yml`,
  which builds installers and publishes the GitHub release. Bump `package.json`
  `version` and move the `CHANGELOG.md` `Unreleased` block to the new version
  before tagging.

## Recommended workflow for non-trivial work

This repo was built with the **superpowers** skill workflow, and its artifacts
live in the tree:

- Design specs: [`docs/superpowers/specs/`](docs/superpowers/specs/)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

For a new feature, prefer: brainstorm → spec → plan → TDD implementation, and
keep the spec/plan in `docs/superpowers/` so the next agent has the context.

## The fastest way to be useful

- Adding a provider is the highest-leverage, lowest-risk contribution — the
  contract suite verifies it. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Before claiming anything works: run `npm run typecheck` and `npm test`; for
  UI/flow changes, `npm run test:e2e`. Report real output — never assert green
  without running it.
