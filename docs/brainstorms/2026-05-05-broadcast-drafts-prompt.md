# Scope prompt: Broadcast drafts (admin + persistence)

> Paste this into a fresh Claude Code session in the `GPC_Social_Members` repo. Run `/ce-plan` against it, then implement.

---

## What to build

Persistence + admin UI for **broadcast drafts** so a half-finished broadcast can be saved, listed, edited, sent, or discarded. Useful for admins composing longer broadcasts across sittings.

## Current state (verified)

- `broadcasts` table exists. Rows are inserted at **send time** by `app/api/admin/broadcasts/send/route.ts` via `lib/broadcast/send.ts`. There is no row before send.
- `broadcasts.status` already exists and stores `sent` / `failed`-style values from the orchestrator. It does **not** currently include `draft`.
- `audience_filter` is a JSONB column with the shape `{ status, tier_ids? } | { status, tier_id? }` (legacy). Both shapes are tolerated by the read paths — see `docs/solutions/conventions/jsonb-filter-singular-to-plural-evolution.md`.
- The composer at `components/admin/BroadcastComposer.tsx` is in-memory only — no save button, no drafts list. It opens preview + send paths against `/api/admin/broadcasts/preview` and `/api/admin/broadcasts/send`.
- `/admin/messages` lists sent broadcasts via `components/admin/BroadcastList.tsx`.
- `/admin/messages/new` renders the composer.

## Goals

1. An admin can **save a draft** of a broadcast — subject, body HTML, audience filter — without sending it.
2. Drafts are visible in the admin: either as a tab on `/admin/messages` (`Sent | Drafts`) or as a separate `/admin/messages/drafts` page — pick whichever fits the existing tone.
3. From a draft, the admin can **edit and update**, **send** (transitions to the existing send pipeline), or **discard** (delete the row).
4. The send pipeline accepts an existing draft id as input and updates the same row to `sent` / `failed` rather than inserting a new one. No orphan drafts after send.

## Non-goals

- Scheduled sends (send-at-time-X). Drafts only; sending stays manual.
- Versioning or revision history. Edits overwrite.
- Multi-author concurrent editing. Last-write-wins is fine.
- Templating beyond the existing `{{first_name}}` / `{{last_name}}` / `{{tier_name}}` merge variables.
- Drafts visible to non-super-admins. Same auth scope as the existing send/preview routes.

## Acceptance criteria

- `broadcasts.status` enum (or check constraint) includes `'draft'` alongside the existing values; existing rows untouched.
- `broadcasts` rows in `status='draft'` are silently excluded from any aggregate "sent broadcasts" stats.
- A new "Drafts" tab on `/admin/messages` lists `status='draft'` rows with subject, last-updated timestamp, recipient-count preview (resolved on demand or stored at save time — pick one and document why), and Edit / Send / Discard actions.
- The composer at `/admin/messages/new` gains a **Save draft** button next to the existing Preview / Send buttons. Saving an already-saved draft updates the row.
- `/admin/messages/drafts/[id]/edit` (or equivalent) loads a draft into the composer for editing.
- The existing send pipeline (`POST /api/admin/broadcasts/send`) accepts an optional `broadcast_id` and, if present, updates that row from `draft` → `sending` → `sent`/`failed`. No new row is inserted.
- A draft can be discarded (`DELETE /api/admin/broadcasts/drafts/:id`) — row removed; UI redirects to drafts list.
- All changes type-check (`npx tsc --noEmit`).

## Hints / constraints

- Validation already lives partly in `app/api/admin/broadcasts/send/route.ts` (subject required, body required, allowed statuses). Pull the shared bits into `lib/broadcast/validate.ts` (or similar) so the new draft route and the existing send route both use the same checks.
- Don't change `audience_filter`'s on-disk shape. Continue accepting `tier_ids` as the canonical form and reading legacy `tier_id` as fallback.
- The composer uses a TipTap WYSIWYG editor — `bodyHtml` is already HTML; persist as-is.
- Use the existing Supabase MCP-generated types (`types/database.ts`). After any schema change, regenerate types and re-append the manual aliases per memory note `feedback_db_types_aliases`.
- For drafts list "recipient count": resolving on demand is simpler and stays accurate as the audience changes; storing at save time is faster but stale. **Default to on-demand; cache only if the drafts list gets slow.**
- Postmark sender stays as-is — `contact@genevapolo.com` via `POSTMARK_BROADCAST_FROM`.
- Add PostHog events for `broadcast_draft_created`, `broadcast_draft_updated`, `broadcast_draft_discarded`, `broadcast_draft_sent` so the existing analytics install picks them up. Optional but cheap.

## Suggested workflow for the next session

1. `/ce-plan` with this file as input. Plan should cover: migration for `status='draft'`, draft API routes, composer Save-draft button, drafts list UI, send-pipeline reuse with `broadcast_id`.
2. Implement migration + types regen.
3. Implement draft API routes.
4. Wire composer + drafts list.
5. Adapt send pipeline to accept `broadcast_id`.
6. Verify in dev: create draft → reload → edit → send. Confirm no orphan rows after send.
7. Commit + push.

## Files most likely to change

- `supabase/migrations/<new>_broadcasts_draft_status.sql`
- `types/database.ts` (regen + manual alias re-append)
- `lib/broadcast/types.ts` — add `'draft'` to status union
- `lib/broadcast/validate.ts` (new) — shared composer/send/draft validation
- `lib/broadcast/send.ts` — accept optional existing `broadcast_id`
- `app/api/admin/broadcasts/drafts/route.ts` (new) — POST list + create
- `app/api/admin/broadcasts/drafts/[id]/route.ts` (new) — GET / PATCH / DELETE
- `app/api/admin/broadcasts/send/route.ts` — accept `broadcast_id`
- `app/(admin)/admin/messages/page.tsx` — Sent / Drafts tab UI
- `app/(admin)/admin/messages/drafts/[id]/edit/page.tsx` (new)
- `components/admin/BroadcastComposer.tsx` — Save-draft button, accept `initialDraftId`
- `components/admin/BroadcastList.tsx` — possibly extracted into Sent / Drafts variants

## Definition of done

- I can compose half a broadcast at `/admin/messages/new`, click Save draft, close the tab, return tomorrow, find it under Drafts, edit it, and send it — and the same row transitions through `draft → sent`.
- Type-check is clean. No orphan rows after a send.
