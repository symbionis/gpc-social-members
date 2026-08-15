# CLAUDE.md

Next.js (App Router) + Supabase + Stripe + Postmark, deployed on Railway.

## Check what we already solved

`docs/solutions/<category>/*.md` holds 50 write-ups of problems already hit and fixed:
`database-issues`, `integration-issues`, `logic-errors`, `security`, `best-practices`,
`architecture-patterns`, `design-patterns`, `build-errors`, `runtime-errors`,
`conventions`, `auth`, `ui-bugs`, `tooling-decisions`. Grep it before solving anything
that smells like it has been seen before, and add an entry when you fix something
non-obvious. `docs/plans/` holds dated implementation plans; newest on a topic wins.

`CONCEPTS.md` (repo root) is the shared domain vocabulary — entities, named processes, and
status concepts with project-specific meaning. Useful when orienting to the codebase or
naming things in review.

## The database is shared

Dev and prod are ONE Supabase project (`rmchkoktpzoojlglyfca`). There is no staging.
A migration, an RPC redeclare, or a data fix hits production the moment it runs.

- Verify a SECURITY DEFINER change in a rolled-back transaction before applying:
  `docs/solutions/best-practices/verify-security-definer-rpc-do-block-rollback.md`
- Prove a hot-function rewrite byte-for-byte first:
  `docs/solutions/best-practices/prove-a-hot-function-rewrite-byte-for-byte-before-shipping.md`
- The Supabase MCP's `apply_migration` stamps its own `now()` version and ignores the
  filename, so reconcile immediately after every apply, then re-check that live matches
  the file:
  `update supabase_migrations.schema_migrations set version='<filename timestamp>'
   where version='<mcp auto-stamp>' and name='<name>';`
- A committed migration file is NOT proof it was applied. Check the ledger both ways.
- After regenerating `types/database.ts`, re-append the hand-written `MemberStatus` and
  `PaymentCaptureStatus` aliases. The generator drops them.

## Local dev

- `npm run test:unit` is the unit suite (vitest). `npm test` is Playwright e2e and needs
  `.env.local`.
- `npm run dev` starts an in-process cron against the shared prod DB, and its hourly jobs
  send REAL member email. Kill the server as soon as you are done.
- Instantiate Stripe and Postmark clients in lazy getters, never at module scope: it
  breaks `next build`.
  `docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md`
- `NEXT_PUBLIC_*` vars are baked at build time, so changing one on Railway needs a rebuild.
  `docs/solutions/integration-issues/railway-nextjs-supabase-env-and-url-config.md`

## Working practice

- Work in a git worktree, not on the checked-out branch.
- Never `git add -A` in a worktree; stage explicit paths. A torn-down worktree once
  committed 190 deletions and broke the build.
- Squash-merge repo. Branch from freshly fetched `origin/main`, and verify HEAD against
  `origin/main` before grounding a plan; worktrees drift.
