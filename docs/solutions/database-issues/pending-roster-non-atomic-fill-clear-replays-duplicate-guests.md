---
title: Non-atomic roster fill+clear re-applies name-only guests on Stripe webhook redelivery
date: 2026-07-08
category: database-issues
module: events
problem_type: database_issue
component: payments
symptoms:
  - Duplicate name-only children appear on an event roster after a Stripe webhook retry, while adults on the same registration are unaffected
  - Duplicated children consume issued ticket slots that were meant to stay open for the party self-registration link
  - claim_ticket only dedupes when an email or phone is present, so name-only child records are never idempotent on replay while adults deduped by email are safe
  - The pending_roster presence-gate does not prevent re-application because the clear runs after the fill in the same invocation, so a crash-before-clear re-runs the whole fill
root_cause: logic_error
resolution_type: migration
last_updated: 2026-07-22
severity: high
related_components: [database, background_job]
tags: [stripe, webhook, idempotency, postgres, security-definer, roster, race-condition, events]
---

# Non-atomic roster fill+clear re-applies name-only guests on Stripe webhook redelivery

> **Update (2026-07-22):** The specific amplifier described here — **name-only children** (no email/phone, so `claim_ticket`'s contact-based idempotency branch was skipped) — no longer exists. Mandatory nominative checkout (Phase A / PR #76) now requires a name **and email** on every ticket, and `is_child` was retired entirely (PR #81), so no ticket is name-only. Self-registration was also retired (PR #88). This exact replay-duplication vector is therefore closed. The **core lesson and the fix remain current**: `apply_pending_roster` performs the fill+clear atomically in one transaction under a row lock, and idempotency belongs at the transaction boundary — not per-item on data (names) that has no natural key. Note also that the shared contact-vs-identity dedup trap it touches is documented at [`./contact-only-replay-guard-swallows-people-sharing-an-email.md`](./contact-only-replay-guard-swallows-people-sharing-an-email.md).

## Problem

The Stripe webhook applies a booker-entered guest roster (`pending_roster`) after a paid event registration is confirmed. The first implementation did this as two separate database round-trips from the Node webhook handler:

1. A loop over the stored guests, calling the `claim_ticket` RPC once per guest to flip an `issued` ticket slot to `claimed`.
2. A follow-up `UPDATE` to clear the `pending_roster` column, marking the batch as done.

This is not replay-safe. Stripe redelivers `checkout.session.completed` whenever the handler crashes, times out, or returns a non-2xx — and it can deliver the same event concurrently. If the handler dies in the window **between** the fill loop and the clear `UPDATE`, the roster is still set, so a redelivery re-runs the entire fill from scratch.

Whether that re-run is safe depends entirely on whether `claim_ticket` can recognise a guest it has already claimed. It can only do so by **contact** — email or phone. Adults carry an email, so a replay finds the existing claimed row and returns it unchanged (see the idempotency block in `claim_ticket`, migration `20260622190000_claim_ticket_flip_issued.sql`). Children are **name-only** — no email, no phone — so that dedup branch is skipped entirely. On replay, every named child claims *another* spare `issued` slot. The child is duplicated on the roster, and the extra claims consume slots that were meant to stay open for the party's self-registration link.

The naive escape hatches don't hold: name-based dedup is unsafe (two siblings can legitimately share a first name), and gating the fill on `pending_roster` presence doesn't help either — the clear runs *after* the fill in the same invocation, so a crash-before-clear leaves the column set and the redelivery re-runs the whole fill anyway. The presence gate protects against a *fully finished* registration being reprocessed; it does nothing for the partial-completion window, which is the exact window the recovery path exists to handle.

## Symptoms

- Duplicate name-only children appearing on an event roster after a Stripe webhook retry, while adults on the same registration are unaffected.
- `issued` ticket slots silently consumed, so the party's self-registration link shows fewer open spots than were purchased.
- The bug only surfaces on redelivery (crash, timeout, or Stripe's at-least-once retry), so it is invisible in the happy path and in local single-shot testing.

## What Didn't Work

Three approaches were considered and rejected, each for a concrete reason worth recording:

1. **Rely on `claim_ticket`'s contact-based idempotency to make the loop replay-safe.** This is what the first cut assumed. It works for adults but fails for children: `claim_ticket` only enters its "return the existing claimed row" branch when an email or phone is present (`IF v_email IS NOT NULL OR v_phone IS NOT NULL`). Children have neither, so there is no idempotency key to match on and every replay re-claims.

2. **Add name-based dedup for children.** Tempting, but semantically wrong. A name is not a unique key for a person — two children in the same party can genuinely be named the same. Deduping on name would silently collapse two real siblings into one attendee, dropping a paid slot. A wrong-but-quiet data loss is worse than the duplicate it was meant to prevent.

3. **Gate the fill on `pending_roster` presence alone.** The webhook already does `if (existing.pending_roster) { applyPendingRoster(...) }`. But presence-gating cannot protect the crash-*between*-fill-and-clear window: the clear happens after the loop within the same invocation, so a crash before the clear leaves the roster set, and the redelivery re-runs the full fill. The gate correctly skips a *completed* registration; it is powerless over a *half-completed* one.

The common thread: idempotency was being sought per-item, on data (names) that has no natural idempotency key.

## Solution

Move the fill **and** the clear into a single `SECURITY DEFINER` plpgsql function that runs in one transaction under a row lock. The webhook calls it once. A crash rolls back both the claims and the clear together, so `pending_roster` stays set and a redelivery re-applies cleanly from a clean slate. Concurrent redeliveries serialise on the `FOR UPDATE` lock; the loser reads a now-`NULL` roster and returns without re-claiming.

The synchronous free-registration path (no webhook, no replay) keeps the simple app-side loop — only the replay-prone webhook path needs the atomic RPC.

### Before — app-side loop plus a separate clear (not replay-safe for children)

```ts
// lib/events/roster.ts — called from the Stripe webhook
export async function fillRegistrationRoster(
  registrationId: string,
  attendees: RosterFillAttendee[],
): Promise<void> {
  const supabase = createAdminClient();
  for (const a of attendees) {
    // claim_ticket only dedupes on contact; children carry none, so a replay re-claims.
    await supabase.rpc("claim_ticket", {
      p_registration_id: registrationId,
      p_name: a.name,
      p_email: a.email,          // null for children
      p_ticket_type_id: a.ticket_type_id,
      /* …waiver/consent nulls… */
    });
  }
}

// webhook, after promoting the registration to 'paid':
await fillRegistrationRoster(existing.id, guests);
// SEPARATE round-trip — a crash here leaves the roster set AND the slots claimed:
await supabase
  .from("event_registrations")
  .update({ pending_roster: null })
  .eq("id", existing.id);
```

The gap between those last two statements is the replay hazard: a crash after the loop but before the `update` leaves the roster set, so Stripe's redelivery re-runs the loop and re-claims every child.

### After — one atomic plpgsql function (fill + clear commit together)

```sql
-- supabase/migrations/20260708130000_apply_pending_roster.sql
CREATE OR REPLACE FUNCTION public.apply_pending_roster(p_registration_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_roster jsonb;
  v_guest  jsonb;
BEGIN
  -- Lock the row: a concurrent redelivery waits here, then sees a cleared roster.
  SELECT pending_roster INTO v_roster
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF v_roster IS NULL THEN
    RETURN;                       -- already applied (or the redelivery loser)
  END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(v_roster)
  LOOP
    PERFORM public.claim_ticket(
      p_registration_id,
      v_guest ->> 'name',
      v_guest ->> 'email',        -- null for children; is_child derived from the type
      NULL, NULL, NULL, false, false,
      (v_guest ->> 'ticket_type_id')::uuid
    );
  END LOOP;

  -- Clear in the SAME transaction as the claims → fill + clear commit atomically.
  UPDATE public.event_registrations
  SET pending_roster = NULL
  WHERE id = p_registration_id;
END;
$$;

-- SECURITY DEFINER: revoke from PUBLIC, anon, authenticated — FROM PUBLIC alone is
-- insufficient on Supabase (see the security cross-reference below).
REVOKE ALL ON FUNCTION public.apply_pending_roster(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_roster(uuid) TO service_role;
```

```ts
// lib/events/roster.ts — one RPC, fully replay-safe including children
export async function applyPendingRoster(registrationId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("apply_pending_roster", {
    p_registration_id: registrationId,
  });
  if (error) {
    console.error("[roster] apply_pending_roster failed", { registrationId, err: error });
  }
}
```

```ts
// app/api/webhooks/stripe/route.ts — the whole fill collapses to one guarded call
if (existing.pending_roster) {
  await applyPendingRoster(existing.id);
}
```

Because the claims and the clear are now one transaction, there is no observable state where some children are claimed but the roster is still set. Either the whole batch committed (roster `NULL`, nothing to redo) or nothing did (roster intact, redelivery re-applies from scratch).

## Why This Works

For records you cannot dedupe by content — a name-only child has no natural idempotency key — you cannot get idempotency per item. You have to get it for the batch as a whole, and the only tools that give you that are **atomicity plus a lock**:

- **Atomicity** collapses the fill and the "mark done" step into one transaction. That deletes the partial-completion window entirely. The redelivery's only two possible starting states are "fully done" (roster is `NULL`, the loop is skipped) and "not started" (roster is intact, applied once). There is no "half done" state for a replay to double-apply on top of.
- **The row lock** (`SELECT … FOR UPDATE`) serialises concurrent redeliveries. The first delivery to acquire the lock does the work and clears the column; every other concurrent delivery blocks, then reads `NULL` and returns a no-op. This is what makes it safe under Stripe's at-least-once, possibly-concurrent delivery.

The insight generalises past this one handler: idempotency for un-keyable data is a property of the *transaction boundary*, not of the individual writes.

## Prevention

When a retry-prone handler (a webhook, a queue consumer, a cron job with at-least-once delivery) **applies a batch of side-effects and then marks the batch done**, make the apply and the mark-done a single atomic unit — one database transaction under a row lock — rather than two round-trips. This matters most, and is easiest to overlook, when any item in the batch lacks a natural idempotency key (name-only records, generated rows, anything you can't safely dedupe by content).

Concrete rules of thumb:

- Treat **"loop N side-effects, then clear a flag"** as a replay hazard on sight. The gap between the loop and the clear is a crash window, and every retry re-runs the loop.
- A **presence gate** on the "done" flag only protects the fully-finished case. It does not protect the crash-between-work-and-clear window — which is precisely the window the recovery path is built to handle.
- Don't reach for **content-based dedup** (e.g. by name) to paper over the gap. If the content isn't a real unique key, you'll silently collapse legitimately-distinct records.
- Keep the simple, non-atomic path only where there is genuinely no replay — a synchronous request the user drives once. The moment a code path can be redelivered, it needs the atomic version.

## Related Issues

- [`database-issues/partial-unique-index-stripe-webhook-23505-deadlock`](partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md) — closest sibling: same Stripe webhook (`app/api/webhooks/stripe/route.ts`) and the same "must be replay-safe" cluster, but a different root cause (unique-index 23505 collision on a single-row promotion) and a different fix (catch 23505, 200-ack + refund tag). The two together cover the two shapes of webhook replay hazard: single-row error handling vs. batch apply-then-clear atomicity.
- [`security/supabase-securitydefiner-anon-execute-grant`](../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md) — the new `apply_pending_roster` function is `SECURITY DEFINER`, so it follows that doc's rule: `REVOKE ALL … FROM PUBLIC, anon, authenticated` (revoking `FROM PUBLIC` alone is insufficient on Supabase), then `GRANT EXECUTE … TO service_role`.
- [`logic-errors/stripe-webhook-metadata-missing-skips-cleanup`](../logic-errors/stripe-webhook-metadata-missing-skips-cleanup.md) — same handler, same genre of post-payment side-effect reliability (data-driven conditions, replay-safety), different mechanism.
- [`architecture-patterns/single-writer-field-ownership-across-routes`](../architecture-patterns/single-writer-field-ownership-across-routes.md) — conceptual sibling: the "separate clear-column UPDATE" vs. "one atomic writer" echoes single-writer field ownership, in the same events/ticketing area.
