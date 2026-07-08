# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Event registration & ticketing

### Event
A scheduled club happening that members and guests can register to attend. An Event has a visibility — public or members-only — and exposes one or more Ticket Types.

### Ticket Type
A named, separately-priced category of admission for an Event — for example a standard adult ticket, a children's ticket, or a no-meal option. Each Ticket Type carries a distinct price for every Rate Class, and may or may not consume a seat against the Event's capacity.

### Registration
A confirmed booking made by one Lead for one Event, holding one or more Tickets. A Registration records whether the Lead booked as a member and the rate it was priced at. At most one active Registration exists per person per Event.

A Registration is free when its total is zero (confirmed immediately, no payment) or paid (created as pending, promoted to paid only when checkout completes). Roster slots are seeded on confirmation — immediately for free, after payment for paid.

### Ticket
An individual admission slot belonging to a Registration — one per attendee. A Ticket may be a filled slot (a named, credentialed attendee) or an open slot the Lead has yet to assign.
*Avoid:* Attendee

### Lead
The person who created a Registration and manages it afterward — adding Tickets, assigning guests — through a private manage link. The Lead normally holds one of the Registration's Tickets.

### Top-up
Adding further Tickets to an existing confirmed Registration after booking — the "Buy more tickets" flow. A Top-up is priced at the Registration's original Rate Class and, when it costs money, runs its own checkout before the new Tickets are minted.

### Ticket Credential
The unguessable bearer token carried by each Ticket, rendered as a QR code and used as the entry token at the door. Holding the credential is what admits a guest; identity (name, waiver) is metadata attached around it. Designed so an NFC bracelet could later be paired to the same credential.

### Slot Status
The lifecycle state of a Ticket: **issued** (minted with a credential at purchase, no name yet), **claimed** (filled with a person's name and contact), or **unclaimed** (a legacy open slot predating per-ticket minting).

A Ticket can also be *released* — freed by staff before arrival — which tombstones it (kept for audit, never deleted) so its old credential stops admitting anyone. A checked-in Ticket cannot be released.

### Booking Page
The Lead's self-service page for a Registration, reached by a private manage link, where they name each Ticket, share or forward Tickets to guests, see every QR, and buy more.

### Self-registration
The process by which a guest fills an open Ticket for themselves — entering their own name and contact through a per-Registration link — instead of the Lead naming it on their behalf. It is the fallback for any Ticket left un-named when the Lead books, and claiming an open slot this way moves it from issued to claimed (see Slot Status) without minting a new Ticket.

### Door Console
The public, no-login check-in surface for an Event, opened by staff at a hard-to-guess per-Event link, used to scan Ticket QRs, fill in missing names and waivers, admit walk-ups against unredeemed Tickets, and resend a party's Tickets to its Lead.

## Pricing

### Rate Class
The single classification that decides which price a registrant pays for every Ticket Type in one basket. Resolved once per booking from the registrant's authenticated session and the Event — never from form input — and applied uniformly across the basket. The three classes are Member, Invited Guest, and Public Non-member.

A Registration stores only whether the Lead was a member, not the resolved Rate Class — so an Invited Guest and a Public Non-member are indistinguishable after booking unless re-derived from the Event.

### Member (rate class)
An authenticated, active club member; pays the member price for each Ticket Type.

### Invited Guest (rate class)
A non-member who reaches a members-only Event through a valid invite code; pays the dedicated invite price, which is separate from the public price. Distinct from a Public Non-member: a members-only Event carries no public price at all, so an Invited Guest is the only non-member rate that applies there.

### Public Non-member (rate class)
A visitor registering for a public Event without a membership; pays the non-member price.
