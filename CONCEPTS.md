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

Every seat a Top-up buys is named before payment, on the same terms as the original checkout — one name and one email per seat — so no purchase path can produce an unnamed Ticket. A Top-up is also its own payment: a Registration that has been topped up holds more than one charge, and any refund against it draws on the Registration's charges as a whole rather than assuming a single one.

### Conversion
Changing one existing Ticket to a different Ticket Type on the same Registration — the "Change ticket type" flow — as opposed to a Top-up, which adds new Tickets. Priced at the Registration's original Rate Class.

Upgrade-only: the target Ticket Type must cost the same or more, and the Lead pays the difference (applied immediately when the difference is zero, otherwise through its own checkout first). A Conversion preserves the Ticket's Credential, its Lead-held status, and its named person — it changes only the Ticket Type; the Registration's Ticket count is unchanged, and the Event's seat usage changes only when converting from a non-seat to a seat-consuming Type. Any Ticket Type may be converted to any other of equal or higher price — there is no restriction between categories of Type.

### Cancellation
A holder's request to void one of their own Tickets from the manage link — final on the holder's side — that frees the Ticket's seat immediately and moves it toward a refund. A Cancellation carries its own status, separate from Slot Status: **requested** (voided, seat released, refund outcome undecided) then **refunded** (settled — an admin has sent the money back through the payment provider from the admin surface itself, and the amount returned is recorded against the Ticket).

A cancelled Ticket keeps its row and its Credential but is void for every purpose. Its seat is subtracted from the Event's usage the instant cancellation is requested — so the place can be resold — and no admission path will admit it: the QR scan and a by-name check-in both refuse it, and the door-facing lists omit it altogether, precisely so a freed-and-resold seat cannot admit two people. A Cancellation is the only way a **paid** seat is freed, which is what keeps every freed paid seat accountable for its money: a seat awaiting a refund still counts as revenue, because the club is still holding it, while a settled one does not. A comped seat can also be freed by removing that guest from a Guest List, where there is no money to account for.

### Seat
One unit of an Event's capacity. Most Ticket Types consume a Seat, but not all — a Type may be sold without taking a place, so an Event's Ticket count and its Seat count are not the same number.

The authoritative figure is **live seats**: everything sold, minus everything cancelled. Every capacity decision reads that one figure — the cap warning, the waitlist conversion, the arrivals the door expects — rather than re-deriving a count from booked quantities, because a booking's stated quantity does not shrink when one of its Tickets is cancelled. A Seat awaiting a refund is already free to resell; the money is settled separately.

### Charge Pool
The set of payments backing one Registration, treated as a single pot. A Registration that has been topped up or upgraded holds more than one charge — the original checkout plus one per applied Top-up and priced Conversion — so a refund draws across the pool as a whole rather than assuming a single payment.

Refunds are issued from the admin surface itself, through the payment provider, so the record is a byproduct of the action rather than a step someone must remember afterward. A refund that cannot be covered by the pool is refused rather than partially guessed at.

### Snapshot Price
The per-Ticket amount recorded on a Registration at the moment of purchase. Repricing a Ticket Type later never changes what an existing booking is worth — what a Seat refunds is what it was sold for, not what the same Type costs today.

### Ticket Credential
The unguessable bearer token carried by each Ticket, rendered as a QR code and used as the entry token at the door. Holding the credential is what admits a guest; identity (name, waiver) is metadata attached around it. Designed so an NFC bracelet could later be paired to the same credential.

### Slot Status
The lifecycle state of a Ticket: **issued** (minted with a credential at purchase, no name yet), **claimed** (filled with a person's name and contact), or **unclaimed** (a legacy open slot predating per-ticket minting).

A Ticket can also be *released* — tombstoned rather than deleted, so the old credential stops admitting anyone while the identity and waiver record survives. Releasing is no longer how a **paid** seat is freed; that is a Cancellation, so the seat and its money are accounted for together. The remaining release path is removing a comped guest from a Guest List, which shrinks the party and returns the seat to the Event. A released row is never a live seat, and anything counting seats or money must exclude it.

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

## Finance & attribution

### Originator
An admin credited with bringing a member into the club. Being an originator is a flag on an admin account, independent of that account's role, and each originator has a personal invite link that can be deactivated without disturbing credit for members already brought in. Distinct from a Referral: the Originator is the standing credit held on the member, while a Referral is the record of one member having arrived through them.

### Referral
The record that a member was brought in by an Originator, written when an originator-sponsored application is approved, and remembering which invite code was used.

A Referral also carries a *converted* timestamp, which reporting reads to count an Originator's conversions within a date range. Nothing currently sets it, so that count reads as none — the record is created at approval rather than tracked from first click through to conversion.

### Attribution
Crediting membership revenue to a member's Originator for reporting. Attribution is current-state rather than snapshotted at payment time, and is credited at sign-up rather than per transaction. Two consequences follow, both deliberate: reassigning a member's Originator moves that member's entire payment history with them, and a renewal is credited to whoever signed the member up even years later. The Originator who drove a particular renewal is recorded, but Attribution does not read it.

Attribution covers membership dues only — event ticket revenue is not attributed — and carries no commission rate, ledger, or payout, none of which are modelled. It is a performance view, not a payout basis.

### Direct (no originator)
The named bucket for revenue from members with no Originator. Not an absence in the UI — it is reported as its own row so attributed and unattributed revenue always reconcile to the total.

### Event Revenue
What an Event actually collected: gross ticket sales minus settled refunds. **Net is the figure to report** — gross alone overstates what the club holds, and once did so by more than double for a single Event.

A Seat awaiting a refund still counts, because the club is still holding the money; only a settled refund is subtracted. Pending refunds are surfaced as their own figure rather than folded into either side, so the amount about to leave is visible before it does. The club's own records mirror the payment provider, and the provider is the authority whenever the two disagree.

## Flagged ambiguities

- **"Expected"** means two different numbers depending on the surface: the admin reads it as live Seats (sold minus cancelled), while the door still totals booked quantities. The gap between them is reported rather than hidden, but the word alone is not precise enough to use unqualified.
- **"Attendee"** is retired in favour of **Ticket** — see that entry.
- **"Pre-registered"** was retired as a concept. Every Seat is named at purchase, so there is no separate un-named-but-expected population.
