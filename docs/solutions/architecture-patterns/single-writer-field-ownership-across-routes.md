---
title: "Single-writer field ownership: a relocated field's PATCH route must be its only writer"
date: 2026-05-22
last_updated: 2026-05-26
category: docs/solutions/architecture-patterns/
module: events
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "A per-record field's editor is relocated from a shared create/edit form into a dedicated tab saved by its own PATCH route"
  - "A bulk update route rebuilds a whole record from a form payload that no longer sends every field"
  - "Two routes can both write the same column and one of them coerces missing input to a default"
  - "Two client surfaces save through the same partial-update route, but only one owns a given field"
  - "Splitting one drawer/form into multiple independent save surfaces"
symptoms:
  - "Editing an unrelated field (title, description) silently blanks another field"
  - "A field resets to [] or null after a save, with no error surfaced"
  - "A value saved via its dedicated tab disappears on the next bulk edit"
  - "A value owned by one UI panel is nulled when a different panel saves the same row"
related_components:
  - database
  - payments
tags:
  - architecture
  - single-writer
  - write-path-ownership
  - carry-through
  - read-modify-write
  - silent-data-loss
  - api-route
  - partial-update
  - next-app-router
---

# Single-writer field ownership: a relocated field's PATCH route must be its only writer

## Context

A common refactor: a per-record field that used to be edited inside a big "create/edit" drawer gets its own dedicated editing surface — a tab on a detail page that saves through a partial-update endpoint (`PATCH .../settings`). In the events admin, two fields made that move:

- `seat_cap` (ticket cap) → Settings tab (PR #28)
- `reminder_schedule` (extra reminders) → Messaging tab (PR #29)

The trap: the original drawer still saves through a *bulk* "rebuild the whole record" endpoint — `POST /api/admin/events/update` — which destructures the full form payload and calls one big `.update({...})`. As long as that bulk writer still lists the relocated field, you now have **two writers** for one column: the dedicated PATCH, and the bulk update. Because the drawer no longer sends the field, the bulk writer receives `undefined` and coerces it (`?? []`, `|| null`) to an empty value — silently overwriting whatever the dedicated tab saved.

A third instance (PR #35) surfaced a **second shape** of the same trap. When the per-type ticket model landed, each ticket type's guest price (`invite_price`) is edited only in the invite-link Settings panel — but the event editor (`EventManager` → `TicketTypesEditor`) also round-trips every ticket-type row through the *same* per-type endpoint, `PATCH /api/admin/events/[id]/ticket-types/[ticketTypeId]`. There is only **one server writer** here, yet **two client surfaces** post to it. The editor's body omitted `invite_price`, and the route's `normalizeTicketType` coerced the absent value to `null` — so saving any unrelated edit (a title fix) silently wiped every guest price, and the invite link fell back to "not open yet." Same silent-data-loss signature, different mechanism: the second writer isn't a second *route* you can delete the field from — it's a shared *form* that has to send a body.

## Guidance

**Single-writer ownership.** Once a field's editing moves to a dedicated partial-update endpoint, that endpoint must be the *only* writer. Remove the field **entirely** from the bulk writer — both the destructure and the `.update()`/`.insert()` object. Don't make it conditional; just delete it.

**The dedicated PATCH applies only what the caller sent**, gated per-field with `"x" in body` so an absent key is never touched (distinct from a key explicitly set to `null`):

```ts
// settings/route.ts — per-field, presence-gated, single writer
const updates: { seat_cap?: number | null; reminder_schedule?: ReminderEntry[] } = {};

if ("seat_cap" in body) {
  const raw = body.seat_cap;
  if (raw === null || raw === "") updates.seat_cap = null;
  else { /* validate positive integer */ updates.seat_cap = parsed; }
}

if ("reminder_schedule" in body) {
  const result = validateReminderSchedule(body.reminder_schedule);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  updates.reminder_schedule = result.value ?? [];
}

if (Object.keys(updates).length === 0)
  return NextResponse.json({ error: "No valid settings to update" }, { status: 400 });
```

**Bulk writer after the fix** — the relocated fields are gone, and a comment marks where ownership moved so the next editor doesn't "helpfully" re-add them:

```ts
// update/route.ts
// seat_cap and reminder_schedule are managed on the event's Manage page
// (PATCH .../settings) — the Settings and Messaging tabs respectively — not
// here, so editing an event never touches the ticket cap or reminder schedule.

const { error } = await adminClient.from("events").update({
  title, /* ... */ price_member: priceMember, price_non_member: effectivePriceNonMember,
  // no seat_cap, no reminder_schedule
}).eq("id", event_id);
```

**Create route**: new rows start at column defaults; the field is configured afterward on the detail page. (In this codebase `create/route.ts` still writes `reminder_schedule: reminderResult.value ?? []` at insert — acceptable only because create receives a real payload, but the cleanest end state drops it from create too and lets the column default apply, matching how `seat_cap` is already handled with just the explanatory comment.)

### When you can't remove the writer: carry-through

Removing the field works when the second writer is a **separate server route** (Shape A above — `seat_cap`, `reminder_schedule`). But sometimes there is structurally **one server writer** and the second writer is a **shared client form** that round-trips the whole record through that one endpoint (Shape B — the ticket-type editor and the Settings panel both PATCH the per-type route). You can't "delete the field" from a form that must submit a body.

Here single-writer is preserved by **carry-through**: the borrowing surface *loads* the owned field and *echoes it back unchanged*, so its write never nulls it — while the owning surface stays the only place that *changes* it. The carried value must be sourced from the **loaded row, not a form default** — sourcing it from a default is exactly the regression the "conditional write" warning below names.

```ts
// EventManager.tsx — load the owned field into editor state on edit
invite_price: t.invite_price === null ? "" : String(t.invite_price),

// EventManager.tsx — echo it back unchanged in the PATCH body
function ticketTypeBody(t: TicketTypeDraft) {
  return {
    title: t.title.trim(),
    price_member: t.price_member,
    price_non_member: t.price_non_member,
    // Preserve the existing guest price (edited only in Settings) so a PATCH
    // from this editor never nulls it.
    invite_price: t.invite_price,
    counts_as_seat: t.counts_as_seat,
  };
}
```

Both shapes share the same backstop: the bulk route carries an explicit *do-not-write* list naming every relocated column, so a future edit can't re-introduce the wipe.

```ts
// update/route.ts — the bulk writer enumerates what it will NOT write
// Single-writer ownership — this bulk update route MUST NOT write:
//   seat_cap, reminder_schedule   → Manage page (Settings / Messaging)
//   invite_code                   → invite-code route
//   all ticket-type prices (event_ticket_types.price_member / price_non_member
//                            / invite_price) → ticket-types route
```

## Why This Matters

This is a **silent data-loss** bug, which is the worst kind. There's no error, no rejected save, no log line. An admin carefully sets a 50-ticket cap or a custom reminder schedule on the dedicated tab. Later, someone fixes a typo in the event *title* through the drawer. The bulk update fires, `reminder_schedule` arrives as `undefined`, `?? []` turns it into an empty array, and the schedule is gone. Nothing tells anyone. The corruption is triggered by an edit to a completely unrelated field, so it's nearly impossible to correlate cause and effect after the fact.

**"Conditional write" is the inferior fix.** You *could* keep the field in the bulk writer and guard it (`if (reminder_schedule !== undefined) update.reminder_schedule = ...`). That stops the wipe, but:

- It's more code and duplicates validation logic across two endpoints.
- It leaves **two writers** for one column — the exact ambiguity that caused the bug. The next person can't tell which endpoint owns the field, and the conditional is one careless edit away from regressing.
- Presence detection through a destructured bulk payload is fragile; a form that sends a stale or default value re-introduces the wipe.

Removing the field entirely makes ownership unambiguous and structurally impossible to overwrite from the wrong place.

That warning is about **Shape A** — keeping a removable field in a second *server* writer. **Shape B** (carry-through on a shared client form) is different: there is structurally one server writer and the field can't be dropped from the form's payload, so carrying the loaded value through is the *correct* fix, not the inferior one. And the danger the warning names — *a form that sends a stale or default value re-introduces the wipe* — is precisely the bug in the ticket-type case: `normalizeTicketType` turned an absent `invite_price` into `null`. Carry-through neutralizes it by sourcing the value from the loaded row, so "absent" can never happen.

## When to Apply

Apply this whenever you split a field's editing out of a "save the whole record" form into its own partial-update endpoint:

- The original endpoint rebuilds the full record from a form payload (`.update({ ...formData })` / `.insert({ ...formData })`).
- The new endpoint does partial updates and the source form no longer sends the field.
- More generally: any time you have a bulk writer and a partial writer touching the same column. Pick one owner.
- Or: two client surfaces saving through the *same* route where only one owns a field — the others must carry it through (Shape B).

Checklist on every such refactor:

1. Delete the field from the bulk writer's destructure **and** its `.update()`/`.insert()` object.
2. Make the partial endpoint presence-gate each field with `"x" in body`.
3. Leave a comment at the bulk writer pointing to the new owner.
4. Verify by editing an *unrelated* field through the bulk path and confirming the relocated value survives. (This was the live regression check that caught the issue on the deployed PR.)
5. **Shape B (shared client form):** if the field can't be removed because a second client surface round-trips the whole record through one route, load it and echo it through unchanged — sourced from the loaded row, never a default — and keep the owning surface as the only place that *edits* it.

## Examples

**The wipe (before).** Drawer stops sending `reminder_schedule`; bulk update still writes it:

```ts
// update/route.ts — BEFORE (latent wipe)
const { /* ... */ reminder_schedule } = await request.json(); // arrives undefined
const result = validateReminderSchedule(reminder_schedule);   // -> value: []
await adminClient.from("events").update({
  title, /* ... */
  reminder_schedule: result.value ?? [],  // blanks the saved schedule on ANY edit
}).eq("id", event_id);
```

**The fix (after).** Field removed from the bulk writer; settings PATCH is the sole, presence-gated writer:

```ts
// update/route.ts — AFTER: reminder_schedule no longer destructured or written.
await adminClient.from("events").update({
  title, /* ...everything except seat_cap & reminder_schedule */
}).eq("id", event_id);
```

```ts
// settings/route.ts — AFTER: the only writer, only touches keys the caller sent.
if ("reminder_schedule" in body) {
  const result = validateReminderSchedule(body.reminder_schedule);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  updates.reminder_schedule = result.value ?? [];
}
```

**Net effect:** editing the event title through the drawer touches `title` and leaves `reminder_schedule` / `seat_cap` exactly as the dedicated tabs last saved them.

**Shape B — carry-through (ticket-type guest price, PR #35).** The per-type endpoint is the lone server writer, but two client panels post to it. Before, the editor's `ticketTypeBody` omitted `invite_price`, so `normalizeTicketType` nulled it on every save:

```ts
// EventManager.tsx — BEFORE: body omits invite_price
{ title, price_member, price_non_member, counts_as_seat }
// → normalizeTicketType coerces the absent invite_price to null
// → .update(...) wipes the guest price the Settings panel saved
```

After, the editor loads it and echoes it back, so an unrelated edit preserves it; Settings stays the only place to *change* it (see the carry-through snippet in Guidance). **Net effect:** editing a ticket type's title leaves its guest price intact.

## Related

- [Slot-based reminder scheduling](../design-patterns/slot-based-reminder-scheduling-2026-05-18.md) — defines the `reminder_schedule` shape and its dedicated PATCH writer; this doc explains why the bulk event-update route must *not* also write it.
- [Draft row claim and transition](../design-patterns/draft-row-claim-and-transition-2026-05-06.md) — a sibling route-ownership pattern that guards state-dependent mutations with status conditions instead of removing the field; same "one owner per write" principle, different mechanism.
- [Supabase row-fetch undercount when aggregating](../database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md) — a parallel `seat_cap` safety issue from the same PR #28 work; both express that certain fields belong to dedicated, deliberate write paths rather than incidental bulk routes.
- [Reusing a force-null column as a value source](./reusing-nullable-column-as-value-source-trap.md) — the sibling events-pricing learning that introduced `invite_price` as a dedicated column; this doc covers that column's *wipe* failure mode, the *reuse-as-zero* failure mode lives there.
- Source PRs: #28 (`seat_cap` → Settings) established the pattern; #29 (`reminder_schedule` → Messaging) applied it during merge-conflict resolution; **#35** (per-type ticket model) added Shape B — carry-through of `invite_price` through the shared editor.
