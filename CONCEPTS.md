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
