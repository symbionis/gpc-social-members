---
title: Audit production before assuming you need a data migration
date: 2026-06-23
category: best-practices
module: events-ticketing
problem_type: best_practice
component: database
severity: medium
related_components:
  - email_processing
  - payments
applies_when:
  - "A shipped schema or feature change raises the question of what to do about existing records"
  - "A migration applied a relevance cutoff (a date window or status filter) that scopes which rows it touched"
  - "You are about to write a one-off backfill migration before measuring the real gap"
  - "The remaining gap might be communication or UX rather than missing data"
  - "A public no-auth surface needs to trigger an action an admin route already performs"
tags:
  - migration
  - backfill
  - production-audit
  - idempotency
  - postmark
  - email-templates
  - ticketing
---

# Audit production before assuming you need a data migration

## Context

A per-ticket QR ticketing system (FEAT-41) shipped to GPC Social Members. Shortly after, the owner asked: *"How do we deal with existing registrations now we have a new ticketing system in place?"*

That phrasing has the shape of a classic data-migration request — the kind that pulls you straight toward writing a backfill to retrofit old rows into the new schema. That instinct is the trap. Acting on it would have meant authoring an irreversible production migration **before establishing whether any data was actually missing**.

The reframe came from looking before building. A read-only production audit showed the FEAT-41 migrations had **already** backfilled every in-flight (upcoming-event) registration with tickets, QR credentials, and `manage_token` booking pages. Past-event rows were deliberately excluded by the migrations' `coalesce(e.end_date, e.start_date) >= current_date` cutoff and treated as archival. For the population that mattered — people who could still attend — the data gap was **zero**. The real gap was that those registrants booked under the old flow and never *received* the new ticket email. "Deal with existing registrations" was never a migration task; it was a "resend the email" task.

## Guidance

**Lead principle: audit production before assuming a data migration.** When a shipped schema or feature change raises "what about the existing records?", the first action is a targeted, read-only query comparing what the migrations *already produced* against what is *actually missing* — not writing a backfill. Split the affected population by relevance before you measure the gap; the gap is often zero for the subset that matters.

```sql
-- Audit shape: bucket by relevance, then measure the gap that actually matters.
select
  case when coalesce(e.end_date, e.start_date) >= current_date
       then 'upcoming' else 'past' end                 as bucket,
  count(*)                                              as paid_free_regs,
  count(*) filter (where t.id is null)                 as regs_with_zero_tickets
from event_registrations r
join events e on e.id = r.event_id
left join tickets t on t.registration_id = r.id and t.released_at is null
where r.status in ('paid', 'free')
group by 1;
-- upcoming bucket: 0 with zero tickets → the backfill was already complete.
-- The "migration" was never needed; only an email resend was.
```

**Use a NULL timestamp column as both "not yet done" and an idempotency signal.** The fix added `ticket_email_sent_at timestamptz` (nullable, **no backfill**) to `event_registrations`. NULL means "not yet notified"; it is stamped **on send success only**, so a failed send stays NULL and remains retryable. The bulk resend targets `ticket_email_sent_at IS NULL`, so re-runs never double-send. Crucially, the *existing* callers (the registration handler and the Stripe webhook) stamp the column on their normal sends too — which automatically excludes brand-new registrants from the bulk set, so it only ever picks up the genuine pre-feature backlog.

```sql
alter table event_registrations
  add column if not exists ticket_email_sent_at timestamptz;  -- nullable, no backfill
```

**Public, no-login surfaces cannot reuse admin-authed routes.** The door console is public (keyed on a hard-to-guess event id; `/api/public/door/[id]/*` endpoints validated by `resolveDoorEvent`, no admin auth). The admin resend route uses `assertAdmin`, so it couldn't be reused on the door. The right move was a **separate door-scoped public endpoint** matching the door's existing trust model — safe here because the email is delivered only to the registrant, exposing no new data to the operator.

**Treat the live email template as the source of truth; repo copies are documentation that drifts.** The repo copies in `docs/email-templates/*.{html,txt}` were stale (missing the FEAT-41 `manage_url`/QR blocks). The deployed Postmark template is canonical. Sync edits *into* the live template, then pull the live bodies *back* into the repo to reconcile.

```js
// Sync the new block into the LIVE template, then reconcile the repo copies.
// Token via `railway run` so it never prints; fetch-first to inject precisely.
const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);
const tmpl = await client.getTemplate("event-registration-confirmed"); // fetch live
// inject the {{#resend}} block into tmpl.HtmlBody / tmpl.TextBody, idempotently
await client.editTemplate("event-registration-confirmed", {
  HtmlBody: newHtml, TextBody: newText,  // bodies only → preserves Subject + layout
});
```

**Make the template conditional degrade safely so code can ship before the template edit.** Use `{{#resend}}...{{/resend}}` — Postmark Mustachio, **not** `{{#if}}`. With `resend` absent/false the block renders nothing, so the code that passes the flag is safe to deploy *before* the live template gains the block, without breaking normal confirmations. *(auto memory [claude]: [[feedback_postmark_mustachio]] — no `{{#if}}`; use `{{#key}}...{{/key}}`; pass `null` not `""`.)*

**Hand-edit generated types to preserve aliases.** The new column was added to `types/database.ts` by hand rather than a full Supabase type regen, because regen drops the hand-written aliases. *(auto memory [claude]: [[feedback_db_types_aliases]] — re-append aliases after any regen.)*

## Why This Matters

- **Avoided an unnecessary, irreversible backfill migration.** The audit turned a presumed schema-migration project into a one-action email resend. No production write was made where none was warranted, and the past-event archival cutoff was respected instead of accidentally reactivated.
- **Correct, idempotent communications.** The NULL-stamp pattern guarantees no member is double-emailed across reruns, failed sends stay retryable, and new registrants are never swept into the backlog set — all from one nullable column and a single `IS NULL` filter.
- **A safe public endpoint instead of a security shortcut.** Rather than loosening the admin route or bolting admin auth onto the public door, a purpose-built door-scoped endpoint matched the existing trust model and exposed no new data.
- **No template breakage from deploy ordering.** The safely-degrading conditional decoupled the code deploy from the live-template edit, and syncing the live template back into the repo stopped the documentation copies from drifting further.

## When to Apply

Apply this any time a shipped schema or feature change raises **"what about the existing records?"** — especially when the request *sounds* like a data migration. Concretely:

- A new feature adds columns/credentials and you're tempted to backfill old rows before measuring whether they're already populated.
- A migration applied a relevance cutoff (date window, status filter), so the "affected" population is narrower than it first appears.
- The remaining gap might be **communication, not data** (users who predate a feature simply never got notified).
- You need a one-shot bulk operation over historical rows that must be **safely re-runnable**.
- A public/no-auth surface needs to trigger an action an admin route already performs.

## Examples

**1. Audit-first reframe (the headline).** *Before:* write a migration to backfill tickets + QR + booking pages onto all existing `event_registrations`. *After:* read-only SQL bucketed by `coalesce(e.end_date, e.start_date) >= current_date` showed upcoming registrations had **zero** missing tickets/credentials; past rows were intentionally archival. The only deliverable was resending the existing-but-never-sent ticket email. The migration was never written.

**2. NULL-stamp idempotency.**

```ts
// Stamp on SUCCESS only — a failed send stays NULL and gets retried next run.
const res = await sendEventRegistrationConfirmation(reg.id, { resend: true });
if (res.success) {
  await admin.from("event_registrations")
    .update({ ticket_email_sent_at: new Date().toISOString() })
    .eq("id", reg.id);
}
// Bulk action selects only `.is("ticket_email_sent_at", null)`, so reruns are safe
// and new registrations (already stamped on their normal send) never appear.
```

**3. Postmark live-template sync with a safely-degrading block.** Ship the code that passes `resend: true` first (absent flag → renders nothing, normal confirmations unaffected), then `getTemplate` → inject `{{#resend}}…{{/resend}}` → `editTemplate({ HtmlBody, TextBody })` (subject + layout preserved) → pull the live bodies back into `docs/email-templates/*` to reconcile the drifted repo copies.

## Related

- `docs/solutions/architecture-patterns/live-table-rename-on-shared-prod-db.md` — the prequel: the FEAT-41 migration that *already moved the data* (this learning is why no further data migration was needed, only a comms/UX notification).
- `docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md` — the `{{#scope}}` not `{{#if}}` rule the `{{#resend}}` block follows (reference, not restated).
- `docs/solutions/database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md` — related registration/idempotency theme (the missing-confirmation-email edge).
- `docs/solutions/security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md` — the public/no-login event RPC auth boundary behind the door endpoint decision.
- `docs/plans/2026-06-23-001-feat-resend-tickets-existing-registrants-plan.md` — the originating plan (introduces `ticket_email_sent_at` and the resend-aware intro block).
- `docs/plans/2026-06-22-001-feat-event-ticket-qr-credentials-plan.md` and `docs/brainstorms/2026-06-22-event-qr-access-flow-requirements.md` — the FEAT-41 feature whose migration created the already-migrated state.
