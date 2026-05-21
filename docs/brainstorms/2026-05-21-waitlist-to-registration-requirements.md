---
date: 2026-05-21
topic: waitlist-to-registration
---

# Convert Waitlist Entry to Registration

## Summary

An admin action on the Manage Event → Waitlist tab that converts a waitlist entry into a confirmed, free (comped) registration. The admin sets a ticket count (default 1), the conversion overrides the event's seat cap, the entry is removed from the waitlist, and the person is emailed a "your spot has freed up — you're confirmed" message via a new Postmark template. Because they become a real registration, they then match automatically at door check-in.

---

## Problem Frame

Events can fill to their seat cap, after which new sign-ups land on the waitlist (`event_waitlist`: name + email only). When a spot frees up — or an organizer simply decides to let a waitlisted person in — there is currently no way to promote them: the waitlist is a read-only list, and the public registration route enforces the cap and (for paid events) payment. The organizer needs a one-click way to confirm a waitlisted person, notify them, and have them show up as a real attendee (including at the door).

---

## Actors

- A1. Admin / organizer: Promotes a waitlist entry to a registration from the Waitlist tab; sets the ticket count.
- A2. Waitlisted person: Receives the confirmation email and becomes a confirmed attendee.
- A3. Member directory: Consulted by email to flag whether the converted person is an active member.

---

## Key Flows

- F1. Convert a waitlist entry to a registration
  - **Trigger:** Admin clicks "Register" on a waitlist row (with a ticket count, default 1).
  - **Actors:** A1, A2, A3
  - **Steps:** Validate the admin and the entry → check the email isn't already registered for this event → look up the email in the member directory → create a free registration (status `free`, amount 0, chosen quantity, generated reference code) ignoring the seat cap → delete the waitlist entry → send the waitlist-confirmed email.
  - **Outcome:** A confirmed free registration exists (possibly over cap), the waitlist entry is gone, and the person is notified.
  - **Covered by:** R1, R3, R4, R5, R6, R7, R9, R11

---

## Requirements

**Admin action**
- R1. On the Manage Event → Waitlist tab, each waitlist entry has a ticket-count input (default 1, integer 1–6) and a "Register" button that converts it.
- R2. When converting, the admin sees the resulting seat usage (e.g. "this will put the event at 501 / 500") so an overbook is visible, not silent. The cap does not block the action.
- R11. The conversion endpoint is admin-only, using the existing `assertAdmin` roles (`super_admin`, `team_admin`, `events_admin`).

**Conversion behavior**
- R3. Converting creates an `event_registrations` row: `status = 'free'`, `unit_amount_chf = 0`, `total_amount_chf = 0`, `quantity` = the chosen ticket count, a generated `reference_code`, and `paid_at = now`.
- R4. The conversion overrides the seat cap — no capacity check blocks it; it may push seats over the cap.
- R5. The waitlisted email is matched against the member directory; an active member sets `is_member = true` and `member_id`, otherwise `is_member = false`. The amount stays 0 regardless.
- R6. If the email already has a `paid`/`free` registration for this event, the conversion is rejected with a clear message and no second registration is created (the waitlist entry is left in place for the admin to remove manually).
- R7. On a successful conversion, the waitlist entry is deleted.
- R8. Conversion is a manual admin action — there is no automatic promotion when a spot frees.

**Email**
- R9. On a successful conversion, send a confirmation email via a new Postmark template (alias `event-waitlist-confirmed`), reusing the existing Postmark Layout, English-only, carrying the "a spot has freed up / you're now confirmed / looking forward to welcoming you" message plus event details and reference code.
- R10. Email send is best-effort: a failed send is logged but does not roll back the registration (consistent with the existing event-registration confirmation behavior).

---

## Acceptance Examples

- AE1. **Covers R3, R4, R7, R9.** Given an event already at its seat cap with a waitlist entry, when the admin converts it with 1 ticket, a free registration is created (event now 1 over cap), the waitlist entry is removed, and the waitlist-confirmed email is sent.
- AE2. **Covers R5.** Given a waitlisted email that matches an active member, when converted, the registration has `is_member = true` and `member_id` set, with amount 0.
- AE3. **Covers R6.** Given a waitlisted email that already has a paid/free registration for the event, when the admin tries to convert, the action is rejected with a clear message and no second registration is created.
- AE4. **Covers R3.** Given the admin sets the ticket count to 3, the created registration has `quantity = 3`.
- AE5. **Covers R9.** Given a successful conversion, the recipient receives the `event-waitlist-confirmed` email (the spot-freed message), not the standard `event-registration-confirmed` email.

---

## Success Criteria

- An organizer can promote a waitlisted person into a confirmed spot in one action, overriding the cap, with the person automatically notified.
- The converted person appears in the Registrations tab and matches at the door check-in with no extra steps.
- A downstream implementer can build without inventing the comp/pricing rule, the email template content, the member-detection rule, or the duplicate-handling behavior.

---

## Scope Boundaries

- No Stripe payment or payment links on conversion — conversions are always comped free, even on paid events.
- No automatic promotion when a spot frees (e.g. on a cancellation) — manual admin action only.
- No waitlist status lifecycle — entries are deleted on conversion, not archived.
- Email is English-only — no bilingual (FR/EN) version, matching all existing transactional emails.
- No bulk/multi-select conversion — one entry at a time.

---

## Key Decisions

- Always comp as a free registration (`status free`, amount 0) regardless of the event's price: the organizer is gifting the freed spot; the "you're now confirmed" framing implies no payment step (see origin: this brainstorm).
- The seat cap is overridden by design — promoting from the waitlist is exactly the case where overbooking is intended; the admin just sees the resulting count.
- New Postmark template `event-waitlist-confirmed`, English, reusing the existing Layout, created via the Postmark client's `createTemplate` (the same client already used for `editTemplate` in the admin email-templates route).
- Member detection by email lookup is acceptable here because this is an authenticated admin action — distinct from the public registration flow, which deliberately trusts only the auth session, never a typed email.
- Ticket count defaults to 1, bounded 1–6, matching the existing registration quantity cap.
- Duplicate guard: reject rather than create a second registration; mirrors the register route's existing paid/free duplicate guard.
- Email is best-effort (no rollback on failure), consistent with `sendEventRegistrationConfirmation`.

---

## Dependencies / Assumptions

- Reuses the registration-creation pattern and `reference_code` generator from `app/api/events/[id]/register/route.ts`, and `sendEmail` from `lib/postmark.ts`.
- `event_waitlist` has only `id`, `event_id`, `name`, `email`, `created_at` (no quantity or status) — verified.
- The Waitlist tab exists on the Manage Event page (PR #20 / `components/admin/ManageEventTabs.tsx`).
- Member lookup is by `email` against `members` filtered to active status.
- An existing Postmark Layout is available to wrap the new template (alias to confirm in planning).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9][Needs research] The exact alias of the existing Postmark Layout to reference from the new template, and the final email copy wording (to be drafted).
- [Affects R2][Technical] Whether the resulting-seat-count display is a passive label or a confirmation step before an overbooking conversion.
- [Affects R5, R6][Technical] The exact member-by-email and existing-registration lookup queries (case-insensitive email handling, mirroring the check-in matching helper).
