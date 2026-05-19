---
date: 2026-05-19
topic: event-registration-cap
---

# Event Registration Cap & Waitlist

## Summary

Add an optional seat cap to events. When paid (and free) registrations consume all seats, the public registration UI switches to a "Fully booked" state with a minimal name-and-email waitlist form. A low-availability warning surfaces when few seats remain. Admins manage the waitlist manually — no automated promotion, claim links, or expiry.

---

## Problem Frame

Events today have no concept of capacity. Every event with `registration_enabled = true` accepts registrations indefinitely, regardless of physical or operational limits (dinner seats, clinic slots, lounge capacity). When an event in practice fills up, the only lever the admin has is to toggle `registration_enabled` off — which silently stops sales without telling visitors why, and provides no path to recover interested members if a seat frees up.

The cost surfaces in two ways: oversold events (no enforcement, just trust that demand won't outrun seats), and lost demand on full events (a "join waitlist" affordance would capture interest the club currently throws away).

---

## Requirements

**Capacity model**
- R1. Events may carry an optional integer seat cap. Null cap means uncapped (current behaviour).
- R2. Seat usage is computed as the sum of `quantity` across registrations that count toward the cap.
- R3. A registration counts toward the cap when its `status = 'paid'`, OR when the event is free (price-resolved-to-zero for the registrant type) and the registration exists in any non-cancelled status.
- R4. Pending Stripe checkouts on paid events do NOT count toward the cap. Simultaneous final checkouts may oversell by at most one party — this is an accepted trade-off, not a bug.
- R5. The cap applies uniformly to public and member-only events, paid and free.

**Member-facing UI**
- R6. When remaining seats `≤ 5` and `> 0`, the event page shows a low-availability indicator (e.g. "Only 3 seats left").
- R7. When remaining seats `≤ 0`, the event page shows a "Fully booked" state and the primary registration CTA is disabled.
- R8. When fully booked, a waitlist affordance appears alongside the disabled CTA: a "Join waitlist" form capturing name and email only.
- R9. If `registration_enabled = false`, that always wins: the page shows the existing "registration closed" state regardless of capacity, and no waitlist is offered.
- R10. The quantity selector at registration time must not allow a party larger than remaining seats. (E.g. if 2 seats remain, quantity is capped at 2.)

**Waitlist data**
- R11. A new `event_waitlist` record captures `event_id`, `name`, `email`, `created_at`. No quantity, no member linkage, no payment, no status field.
- R12. Anyone may join the waitlist on a public event. On a member-only event, the waitlist form is only shown to authenticated members (same gating as the registration form).
- R13. The same email may sit on a waitlist multiple times (no dedupe). Admin handles duplicates manually.

**Admin**
- R14. The admin event create/edit form exposes a "Seat cap" input (optional integer, blank = uncapped).
- R15. The admin event detail page shows seats used vs cap (e.g. "24 / 30 seats") and lists the waitlist (name, email, signup time) in signup order, oldest first.
- R16. The admin can lower the cap below current seats-used; the system does not auto-cancel registrations. The event simply reads as overbooked until registrations cancel or the cap is raised. The admin form warns when the entered cap is below current usage but does not block save.

---

## Acceptance Examples

- AE1. **Covers R3, R4.** Given an event with `seat_cap = 10` and 8 paid seats consumed, when a member starts checkout for quantity=2, the page still shows 2 seats remaining. They walk away without paying. A second member then registers quantity=2 and pays — they succeed. The first member's abandoned pending registration never counted.
- AE2. **Covers R3, R7.** Given a free event with `seat_cap = 20` and 20 registrations (any non-cancelled status, summing quantity = 20), when a visitor opens the event page, they see "Fully booked" and the registration CTA is disabled.
- AE3. **Covers R6, R10.** Given an event with `seat_cap = 30` and 27 paid seats consumed, when a member opens the event page, they see "Only 3 seats left" and the quantity selector maxes out at 3.
- AE4. **Covers R7, R8, R12.** Given a public event that is fully booked, when a non-authenticated visitor opens it, they see the fully-booked state and a "Join waitlist" form requesting name + email. On submit, a new `event_waitlist` row is created and they see a confirmation.
- AE5. **Covers R9.** Given an event with `registration_enabled = false` AND `seat_cap = 50` AND 10 paid seats consumed, the event page shows the existing "registration closed" state — no "Fully booked" badge, no waitlist form, no low-availability warning.
- AE6. **Covers R16.** Given an event with `seat_cap = 30` and 24 paid seats consumed, when the admin edits the cap to 20 and saves, the form shows a warning ("Cap is below current usage of 24") but the save proceeds. The event is now overbooked-on-paper; no registrations are cancelled.

---

## Success Criteria

- An admin can configure capacity on any event in under a minute and trust that the public site will stop accepting new registrations once full.
- Members who arrive at a full event leave their name + email on the waitlist instead of bouncing — the admin sees a list they can act on manually.
- No member experiences "I registered and paid but there's no seat for me" except in the documented narrow race between simultaneous final checkouts (max oversell = 1 party).
- Existing uncapped events behave identically to today: leaving `seat_cap` null is a no-op.
- ce-plan can produce a complete implementation plan from this doc without inventing product behaviour or capacity edge cases.

---

## Scope Boundaries

- No automated promotion from waitlist to registration. No claim links. No expiry of waitlist entries. Admin contacts waitlisted people manually (email, phone, broadcast) and they re-register through the normal flow if a seat opens.
- No cancellation/refund flow for paid registrations triggered by this work. (Cancellations exist or are added separately.)
- No admin override to register past the cap from the admin UI. If the admin must add someone, they raise the cap first.
- No pending-checkout seat reservation / TTL. Accepted oversell-by-one risk on simultaneous final checkouts.
- No per-tier or per-member-type quotas (e.g. "20 seats for members, 10 for guests"). One pooled cap per event.
- No automatic email to the admin when a waitlist signup occurs. (Can be added later as a notification preference.)
- No member-facing "you've been added to the waitlist" automated email beyond the on-screen confirmation. (Postmark template could be added later.)
- No public count display beyond the low-availability warning. We do not show "24 / 30 registered" to members.

---

## Key Decisions

- **Cap unit is seats (sum of quantity), not registrations.** A party of 3 consumes 3 seats. Matches physical reality of dinners and clinics.
- **Counting rule favours simplicity over strict oversell prevention.** Pending paid checkouts don't hold seats. The maximum harm is one party of oversell on simultaneous final checkouts. Given current event volume this is acceptable; revisit if it bites.
- **Waitlist is a list, not a queue.** No automation, no ordering guarantees beyond `created_at`. The admin's manual workflow is the source of truth for who gets contacted. Keeps the schema and code surface tiny.
- **`registration_enabled = false` always wins over capacity.** Admin can still kill registration regardless of cap state. Capacity is an automatic gate; `registration_enabled` is the manual override.
- **Low-availability threshold = 5 seats.** Fixed constant for now, not configurable per-event. Tunable in code if 5 turns out to be wrong.

---

## Dependencies / Assumptions

- Assumes existing `event_registrations.status` lifecycle reaches `paid` reliably via the Stripe checkout webhook (already in production).
- Assumes the existing member-facing event page and admin event form are the right surfaces to extend; no new pages required.
- Assumes "free event" can be detected from price fields on the event (`price_member` / `price_non_member` resolving to 0/null for the registrant type). To be confirmed in planning if the resolution logic isn't trivial.
- Race-condition handling at the moment of registration insert is a planning-level concern (server-side recount immediately before write; if cap exceeded, reject and refund/skip checkout). Documented here so planning doesn't omit it.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Exact resolution of "free event" — is it `price_member = 0 OR null` for members and `price_non_member = 0 OR null` for non-members? Confirm against existing pricing helper.
- [Affects R4][Technical] Server-side enforcement point for the final cap check on paid events: before creating the Stripe checkout session, or in the webhook handler before marking paid? Choose the option that minimizes the oversell window.
- [Affects R10][Technical] How the existing quantity selector exposes a dynamic max — likely a small change to the existing registration form component.
- [Affects R15][Needs research] Whether the waitlist list view on the admin event page benefits from a CSV export in v1, or whether copy/paste from the table is sufficient.
