---
date: 2026-05-21
topic: event-messaging
---

# Event Messaging

## Summary

Add a Messaging tab to the Manage Event admin page that surfaces the automatic reminder emails already sent for the event and lets an admin compose two kinds of ad-hoc message: a pre-event message to registered attendees (logistics or weather cancellation) and a post-event thank-you to checked-in attendees. It reuses the existing broadcast pipeline and Postmark rather than adding a parallel messaging surface.

---

## Problem Frame

Admins can email members in bulk (the broadcast feature) and the system sends automatic event reminders, but there is no way to reach the people attached to a *specific event*. When something changes close to an event — a venue move, a "bring ID" note, or a weather cancellation — the admin has no in-product way to tell registered attendees, and there is no cancel-event feature to fall back on. After an event, there is no way to thank the people who actually showed up, including door guests who never existed in the member or registration tables.

The admin already manages each event from the Manage Event page, looking at the registration and check-in lists. The information needed to message those exact audiences is on screen, but the action isn't available there.

---

## Actors

- A1. Admin: composes and sends event messages, reviews what reminders have already gone out.
- A2. Registered attendee: signed up (and paid, for paid events) ahead of time; recipient of pre-event messages.
- A3. Checked-in attendee: present at the event via door check-in (registered attendee, member, or guest); recipient of the post-event thank-you. Guests in this group may not exist in any other table.

---

## Key Flows

- F1. Send a pre-event message
  - **Trigger:** Admin needs to reach registered attendees before the event (logistics change, weather cancellation).
  - **Actors:** A1, A2
  - **Steps:** Admin opens the Messaging tab → chooses the pre-event / registered audience → sees the recipient count → composes subject + body → sends → message dispatches and is logged.
  - **Outcome:** All active registered attendees receive the email; the send is recorded in the event's comms log.
  - **Covered by:** R1, R2, R3, R6, R7

- F2. Send a post-event thank-you
  - **Trigger:** Event is over; admin wants to thank attendees.
  - **Actors:** A1, A3
  - **Steps:** Admin opens the Messaging tab → chooses the post-event / checked-in audience → consent override is off by default (only opted-in recipients) → optionally enables override with the transactional-only acknowledgement → composes subject + body → sees the resulting recipient count → sends.
  - **Outcome:** Checked-in attendees (filtered by consent unless overridden) receive the thank-you; the send is recorded, including whether consent was overridden.
  - **Covered by:** R1, R4, R5, R6, R7

- F3. Review reminders already sent
  - **Trigger:** Admin wants to know what the system has already emailed for this event before sending more.
  - **Actors:** A1
  - **Steps:** Admin opens the Messaging tab → sees the automatic reminder sends and any ad-hoc messages for this event in one list.
  - **Outcome:** Admin has a single view of all comms sent for the event.
  - **Covered by:** R8

---

## Requirements

**Messaging tab**
- R1. Add a Messaging tab to the Manage Event page, following the existing tab pattern.
- R8. The tab shows a log of comms already sent for this event: the automatic reminder sends and any ad-hoc messages sent from this tab, each with timestamp, audience, and recipient count.

**Pre-event message (registered attendees)**
- R2. The admin can compose a free-form message (subject + body) to registered attendees and send it.
- R3. The pre-event audience is all registrations for the event that are not cancelled/refunded, regardless of marketing-consent state — treated as transactional contact.

**Post-event message (checked-in attendees)**
- R4. The admin can compose a free-form message (subject + body) to checked-in attendees and send it.
- R5. The post-event audience respects the marketing-consent flag captured at check-in by default. An optional override, labeled for transactional/operational use only, sends to all check-ins regardless of consent. Whether the override was used is recorded on the send.

**Shared sending behavior**
- R6. Before sending, the admin sees the resolved recipient count for the selected audience.
- R7. Each send reuses the existing broadcast dispatch path and Postmark, and writes a per-recipient delivery record consistent with the existing broadcast audit trail.

---

## Acceptance Examples

- AE1. **Covers R3.** Given a registered attendee whose marketing consent is false, when the admin sends a pre-event message, then that attendee still receives it.
- AE2. **Covers R5.** Given a checked-in attendee who did not opt in at check-in, when the admin sends a post-event thank-you with the override off, then that attendee does not receive it.
- AE3. **Covers R5.** Given the same attendee, when the admin enables the transactional-only override and sends, then that attendee receives it and the send record reflects that consent was overridden.
- AE4. **Covers R6.** Given the post-event audience with the override off, when the admin toggles the override on, then the displayed recipient count updates to include non-consented check-ins.

---

## Success Criteria

- An admin can, from one place, see what an event's attendees have already been emailed and send a new message to either the registered or checked-in audience without leaving the Manage Event page.
- A weather cancellation reaches every registered attendee; a post-event thank-you reaches checked-in attendees while honoring the consent they expressed at the door unless the admin deliberately overrides it.
- Every event message is recorded the same way broadcasts are, so the comms log and delivery outcomes are auditable per event.
- A downstream implementer can build this by extending the existing broadcast pipeline and tab pattern, without inventing new audience or sending mechanics.

---

## Scope Boundaries

- Broad CRM/Mailchimp-style comms to anyone who registered or attended with consent — deferred to a later CRM track.
- A real "cancel event" feature (status change, refunds, registration close) — not built here; the pre-event message is the deliberate stopgap.
- SMS or any non-email channel.
- Templated/branded message composition beyond free-form subject + body; the admin authors the message, including any bilingual content, themselves.
- Editing or resending automatic reminder configuration (that lives in existing event/reminder settings).

---

## Key Decisions

- Event-level tab over a separate split messaging area: co-locates messaging with the registration and check-in lists the admin is already viewing, and lets the comms log reuse the per-event reminder send records. Avoids a parallel event-selection flow.
- Post-event consent handled via an override checkbox (default = respect the check-in opt-in) rather than a hard rule or always-send: keeps the consent flag meaningful while allowing genuine operational exceptions, with the override recorded for accountability.
- Pre-event messages are transactional and bypass consent filtering: attendees registered/paid for the event, so event-specific logistics are legitimate transactional contact.
- Reuse the broadcast pipeline and audit trail rather than a new sending path: less to build and maintain, and consistent delivery records.

---

## Dependencies / Assumptions

- Email is the only channel; a weather cancellation sent a few hours before the event may not reach every attendee in time. Accepted for v1.
- The existing broadcast dispatch supports a free-form (non-member-broadcast) message; planning confirms whether the current generic message template covers ad-hoc subject + body or a small addition is needed.
- The post-event audience is sourced from event check-ins (including guests), which carry their own email and marketing-consent fields; the pre-event audience is sourced from event registrations.
- Recipient de-duplication within a single send (e.g., the same email appearing twice) is handled by the dispatch path.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Does the existing broadcast send path accept a free-form subject + body, or is a generic Postmark template / minor adapter change required for ad-hoc event messages?
- [Affects R8][Technical] How are ad-hoc event messages associated with an event for the comms log — an event reference on the broadcast record, or via the audience filter — and how are they merged with reminder sends for display?
- [Affects R6] Whether to gate availability of the pre-event vs post-event compose by event timing (before/after start), or always show both and let the admin choose.
