---
title: Draft-row lifecycle — claim and transition, never insert-on-send
date: 2026-05-06
category: design-patterns
module: lib/broadcast
problem_type: design_pattern
component: service_object
severity: medium
applies_when:
  - "Adding a 'save and resume later' (draft) state to a table that previously only stored in-flight or terminal states (sending / sent / failed)"
  - "The same DB row should represent both the draft and the final audit record after dispatch"
  - "Send / publish / submit pipelines previously inserted a fresh row at dispatch time"
related_components:
  - database
  - email_processing
tags:
  - drafts
  - lifecycle
  - state-machine
  - broadcasts
  - shared-validation
  - row-claim
---

# Draft-row lifecycle — claim and transition, never insert-on-send

## Context

We had a `broadcasts` table whose rows were inserted at **send time** by the
orchestrator (`lib/broadcast/send.ts`). Status values were `sending`, `sent`,
`failed`. There was no row before send — the composer (`BroadcastComposer.tsx`)
was in-memory only.

When adding "save a half-finished broadcast as a draft, come back tomorrow,
edit, send", the obvious-but-wrong shape is: drafts go to a separate table,
or the composer keeps inserting a new row at send time and the draft is
deleted afterwards. Both produce the same hazard — orphan rows on partial
failure, two sources of truth for "what was this broadcast", and a divergent
audit trail for sends-from-draft vs sends-without-draft.

The pattern that worked: extend the existing row's lifecycle backwards to
include `draft`, and have the send pipeline **claim and transition** an
existing draft row instead of inserting a new one.

## Guidance

1. **One table, extended lifecycle.** Add `draft` to the existing status
   constraint alongside `sending` / `sent` / `failed`. Drafts and sent
   records live in the same table and share the same schema. Lists filter
   by status.

   ```sql
   ALTER TABLE public.broadcasts
     ADD CONSTRAINT broadcasts_status_check
     CHECK (status IN ('draft', 'sending', 'sent', 'failed'));
   ```

2. **Send accepts an optional existing row id.** The orchestrator's input
   gains a single optional field. When present, it `UPDATE`s that row through
   `sending` instead of `INSERT`ing.

   ```ts
   export interface SendBroadcastInput {
     subject: string;
     body_html: string;
     audience_filter: AudienceFilter;
     created_by: string;
     /** If provided, transition an existing row (typically status='draft')
      *  through sending → sent / failed instead of inserting a new row. */
     broadcast_id?: string;
   }
   ```

3. **Both shapes share one validation function.** Composer save, draft
   PATCH, and send all run the same payload validator. A single `forDraft`
   flag relaxes the "subject and body required" checks — drafts are
   intentionally partial.

   ```ts
   parseBroadcastPayload(body, { forDraft: true })  // drafts
   parseBroadcastPayload(body)                       // send / preview
   ```

4. **Draft mutations are guarded by status.** `PATCH` and `DELETE` on a
   draft row include `.eq("status", "draft")` in the where clause. A sent
   broadcast cannot be retroactively edited or deleted through the draft
   API even if the caller has the id — the audit record is locked the
   moment it leaves draft.

5. **Aggregate "sent" reads exclude drafts explicitly.** The Sent tab and
   any future stats query filter with `.neq("status", "draft")` so drafts
   never count as deliveries.

## Why This Matters

**Same row, same id, end-to-end.** When an admin clicks Send on a draft
they've been editing, the row's id is preserved into the audit trail. A
support engineer asked "what happened to the broadcast Jane was working on
yesterday?" can follow one id from creation through dispatch. With a
delete-the-draft / insert-the-send pattern, that continuity is severed.

**No orphan drafts.** The hazardous failure mode of "delete draft, then
insert send" is: insert succeeds, send fails halfway through, draft is
already gone — the admin returns to find their work vanished and a
half-failed broadcast they didn't know they sent. With claim-and-transition,
a partial send leaves the row in `failed` status with all the original
content intact; the admin still has their words.

**Single rule set for what counts as valid.** Pulling validation into one
function with a `forDraft` flag means the invariants for "audience.status
must be one of [active, expired, all]" or "tier_ids is the canonical
plural form" are enforced identically across the composer save, draft
PATCH, and final send. Without the shared function, each route grows its
own slightly-different copy and they drift.

## When to Apply

- Any table whose rows currently represent a terminal or in-flight artifact,
  where you're now adding a "work in progress" precursor state
- The draft and final form share enough fields that splitting tables would
  duplicate ~80%+ of the schema
- Lifecycle is linear and one-way (draft → sending → sent/failed) — not a
  branching workflow with rejoinable paths
- The audit trail for "what was sent" should be the same row that captured
  the in-progress work

## Examples

**Send orchestrator — branching on `broadcast_id` in `lib/broadcast/send.ts`:**

```ts
let broadcastId: string;
if (input.broadcast_id) {
  // Transition an existing draft row through 'sending' rather than inserting
  // a new row. Snapshot the latest content/audience too in case the caller
  // is sending without a final PATCH.
  const { data: updated, error } = await supabase
    .from("broadcasts")
    .update({
      subject: input.subject,
      body_html: input.body_html,
      audience_filter: input.audience_filter,
      status: "sending",
      recipient_count: recipients.length,
      skipped_count: skipped,
    })
    .eq("id", input.broadcast_id)
    .select("id")
    .limit(1)
    .single();
  if (error || !updated) throw new Error("Failed to claim draft for send");
  broadcastId = updated.id;
} else {
  const { data: inserted } = await supabase
    .from("broadcasts")
    .insert({ /* ... status: "sending" ... */ })
    .select("id").limit(1).single();
  broadcastId = inserted!.id;
}
// From here on, the rest of the send pipeline is identical for both branches.
```

**Status-guarded draft mutation in `app/api/admin/broadcasts/drafts/[id]/route.ts`:**

```ts
const { data: updated } = await supabase
  .from("broadcasts")
  .update({ subject, body_html, audience_filter })
  .eq("id", id)
  .eq("status", "draft")  // <- locks the row once it leaves draft
  .select("id")
  .limit(1)
  .maybeSingle();

if (!updated) {
  return NextResponse.json(
    { error: "Draft not found or already sent" },
    { status: 404 }
  );
}
```

**Sent-list query that excludes drafts:**

```ts
adminClient
  .from("broadcasts")
  .select("id, subject, ...")
  .neq("status", "draft")          // drafts never count as sent
  .order("created_at", { ascending: false });
```

## Related

- [`docs/solutions/architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md`](../architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md) — the adapter shape this lifecycle plugs into
- [`docs/solutions/conventions/jsonb-filter-singular-to-plural-evolution.md`](../conventions/jsonb-filter-singular-to-plural-evolution.md) — `audience_filter.tier_ids` plural-with-legacy-singular convention used by both draft and send paths
- Memory note `feedback_db_types_aliases` (auto memory [claude]) — after the migration that added the CHECK constraint, `types/database.ts` was regenerated and the manual `MemberStatus` / `PaymentCaptureStatus` aliases re-appended
