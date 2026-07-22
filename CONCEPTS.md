# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Event registration & ticketing

### Event
A scheduled club happening that members and guests can register to attend. An Event has a visibility — public or members-only — and exposes one or more Ticket Types.

### Ticket Type
A named, separately-priced category of admission for an Event — for example a standard ticket or a no-meal option. Each Ticket Type carries a distinct price for every Rate Class, and may or may not consume a seat against the Event's capacity.

### Registration
A confirmed booking made by one Lead for one Event, holding one or more Tickets. A Registration records whether the Lead booked as a member and the rate it was priced at. At most one active Registration exists per person per Event.

A Registration is free when its total is zero (confirmed immediately, no payment) or paid (created as pending, promoted to paid only when checkout completes). Roster slots are seeded on confirmation — immediately for free, after payment for paid.

### Ticket
An individual admission slot belonging to a Registration — one per attendee. A Ticket may be a filled slot (a named, credentialed attendee) or an open slot the Lead has yet to assign.
*Avoid:* Attendee

### Lead
The person who created a Registration and manages it afterward — adding Tickets, assigning guests — through a private manage link. The Lead normally holds one of the Registration's Tickets.

### Guest List
A sponsor's comp list, held as a zero-price Registration — a Lead plus any number of named guests, each with a Ticket Type. Built by an admin, never bought.

Guests are name-only: contact details and waiver are collected at the door on check-in. Unlike a bought Registration, a Guest List has no quantity ceiling — an admin adds or removes guests at any time, and each addition mints a Ticket. Its guests consume seats and may take an Event past its cap. Because a Guest List is an ordinary Registration underneath, the Door Console sees it as a normal party with no special handling.

### Top-up
Adding further Tickets to an existing confirmed Registration after booking — the "Buy more tickets" flow. A Top-up is priced at the Registration's original Rate Class and, when it costs money, runs its own checkout before the new Tickets are minted.

### Conversion
Changing one existing Ticket to a different Ticket Type on the same Registration — the "Change ticket type" flow — as opposed to a Top-up, which adds new Tickets. Priced at the Registration's original Rate Class.

Upgrade-only: the target Ticket Type must cost the same or more, and the Lead pays the difference (applied immediately when the difference is zero, otherwise through its own checkout first). A Conversion preserves the Ticket's Credential, its Lead-held status, and its named person — it changes only the Ticket Type; the Registration's Ticket count is unchanged, and the Event's seat usage changes only when converting from a non-seat to a seat-consuming Type. Any Ticket Type may be converted to any other of equal or higher price — there is no restriction between categories of Type.

### Cancellation
A holder's request to void one of their own Tickets from the manage link — final on the holder's side — that frees the Ticket's seat immediately and moves it toward a refund. A Cancellation carries its own status, separate from Slot Status: **requested** (voided, seat released, refund pending) then **refunded** (an admin has completed the refund in the payment provider).

A cancelled Ticket keeps its row and its Credential but is void for every purpose. Its seat is subtracted from the Event's usage the instant cancellation is requested — so the place can be resold — and every admission path (the QR scan, a by-name check-in, the printed door sheet) refuses it, precisely so a freed-and-resold seat cannot admit two people. Cancellation is distinct from a staff *release* (see Slot Status), which tombstones a Ticket rather than recording a refundable request.

### Ticket Credential
The unguessable bearer token carried by each Ticket, rendered as a QR code and used as the entry token at the door. Holding the credential is what admits a guest; identity (name, waiver) is metadata attached around it. Designed so an NFC bracelet could later be paired to the same credential.

### Slot Status
The lifecycle state of a Ticket: **issued** (minted with a credential at purchase, no name yet), **claimed** (filled with a person's name and contact), or **unclaimed** (a legacy open slot predating per-ticket minting).

A Ticket can also be *released* — freed by staff before arrival — which tombstones it (kept for audit, never deleted) so its old credential stops admitting anyone. A checked-in Ticket cannot be released.

### Booking Page
The Lead's self-service page for a Registration, reached by a private manage link, where they name each Ticket, share Tickets with guests, see every QR, and buy more.

### Household
The set of live Tickets within one Registration that share the same email address — a couple or a family who booked together on one address. The Household is the unit of Ticket delivery and self-service: its Tickets arrive as one grouped email carrying every QR, and are managed together through any one member's Manage Link.

### Manage Link
The private, rotatable per-Ticket link that opens a Ticket's Household — letting whoever holds it view every QR at that address, correct a name or email, upgrade (see Conversion), or cancel (see Cancellation). Distinct from the Ticket Credential: the Manage Link governs the booking, the Credential only admits at the door. Rotating a Manage Link revokes the old one for the whole Household.

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
