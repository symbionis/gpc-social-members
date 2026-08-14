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
An individual admission slot belonging to a Registration — one per attendee, named and contactable at the moment it is created. The Guest List is the sole exception: an admin may add a Guest List guest with a name alone, and the Door Console asks the missing email as part of that guest's check-in.
*Avoid:* Attendee

### Lead
The person who paid for a Registration. Receives its receipts, reaches the Receipt Page, and is notified when a seat they paid for is cancelled by another holder. The Lead holds no management authority beyond that — every holder, the Lead included, manages their own Ticket the same way, through their own Manage Link (see Household). The Lead is not a role a page is built around; it is a mark carried by whichever single Ticket the payer names for themselves at checkout, used to route money-side communication and gate the Receipt Page.

### Guest List
A sponsor's comp list, held as a zero-price Registration — a Lead plus any number of named guests, each with a Ticket Type. Built by an admin, never bought.

Guests are name-only: contact details and waiver are collected at the door on check-in. Unlike a bought Registration, a Guest List has no quantity ceiling — an admin adds or removes guests at any time, and each addition mints a Ticket. Its guests consume seats and may take an Event past its cap. Because a Guest List is an ordinary Registration underneath, the Door Console sees it as a normal party with no special handling.

### Waitlist Entry
A name, email, requested Ticket Type, and quantity recorded when someone tries to register for a fully-booked Event. Not a Registration and not a queue position — an admin decides who to Offer a seat to, in any order, whenever capacity frees up.

### Offer
An admin action that turns a Waitlist Entry into an emailed, per-entry link into ordinary checkout — never a free Registration. An Offer confers no seat hold and no expiry: several Entries can be offered against the same freed capacity, and seats go to whoever completes payment first. The buyer may pick any live Ticket Type, but may buy at most the Entry's requested quantity.

A Waitlist Entry stops being offerable once its Offer is redeemed — that is, once the Registration created from it is paid or free. Withdrawal is the opposite: it cancels an issued Offer, the link stops resolving, and the Entry returns to the queue, offerable again. An Entry whose email already holds a Registration for the Event, with nothing linking the two, is neither redeemed nor offerable: it stays visible to the admin with a reason, because hiding it would look like the Entry had been lost.

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

### Admissible Ticket
A Ticket that can still be let through the door: not cancelled, not released, and in a Slot Status the door recognises. A booking's admissible count is what it bought less what it cancelled, never below zero.

Counted in TICKETS, not Seats — the two differ because some Ticket Types take no Seat, so a booking's ticket count can exceed its seat count. Every door surface — the printed sheet, the check-in console, the admin roster — decides who is arriving from this one rule, so they cannot disagree about who is coming. Capacity is the other question and is answered by live Seats instead; mixing the two is what once printed refunded people onto the door sheet.

### Unaccounted
The door's count of Seats a booking holds that no Ticket row accounts for — a legacy party whose rows were never minted, or a row in a status the door does not recognise. It exists to make that disagreement visible rather than let it inflate a headcount over a list that does not contain those people.

Its value is entirely in being rare. An ordinary business event — a cancellation, a released comp — must never land here, because an alarm that fires during normal operation is one nobody reads.

### Charge Pool
The set of payments backing one Registration, treated as a single pot. A Registration that has been topped up or upgraded holds more than one charge — the original checkout plus one per applied Top-up and priced Conversion — so a refund draws across the pool as a whole rather than assuming a single payment.

Refunds are issued from the admin surface itself, through the payment provider, so the record is a byproduct of the action rather than a step someone must remember afterward. A refund that cannot be covered by the pool is refused rather than partially guessed at.

### Snapshot Price
The per-Ticket amount recorded on a Registration at the moment of purchase. Repricing a Ticket Type later never changes what an existing booking is worth — what a Seat refunds is what it was sold for, not what the same Type costs today.

### Ticket Credential
The unguessable bearer token carried by each Ticket, rendered as a QR code and used as the entry token at the door. Holding the credential is what admits a guest; identity (name, waiver) is metadata attached around it. Designed so an NFC bracelet could later be paired to the same credential.

### Waiver
The single liability text a guest accepts before entering an Event. Deliberately generic — it names no specific Event, so one text serves all of them, and the surface the guest is looking at supplies the occasion.

An acceptance belongs to one Ticket and is never re-stamped: a Ticket already carrying one keeps its original version, moment and language, because re-signing would move a holder onto text they may never have read. Each acceptance records a version derived from the waiver's own wording, which means it attests to the **text and nothing else** — not the language of the surrounding instructions, nor what gesture counted as consent. That is why a single presentation is used wherever the waiver is accepted; a second one would let those diverge while every record still claimed the same version. Acceptance is also never made on another holder's behalf: a Lead naming a guest does not accept for them, and a Manage Link that opens several Tickets offers each its own. It may be accepted ahead of the Event from the holder's own page or at the door, and a Ticket that arrives already accepted is admitted without being asked again.

### Slot Status
The lifecycle state of a Ticket: **issued** (minted with a credential at purchase, no name yet), **claimed** (filled with a person's name and contact), or **unclaimed** (a legacy open slot predating per-ticket minting).

A Ticket can also be *released* — tombstoned rather than deleted, so the old credential stops admitting anyone while the identity and waiver record survives. Releasing is no longer how a **paid** seat is freed; that is a Cancellation, so the seat and its money are accounted for together. The remaining release path is removing a comped guest from a Guest List, which shrinks the party and returns the seat to the Event. A released row is never a live seat, and anything counting seats or money must exclude it.

Door **roster** surfaces — the lists staff read from — admit **issued** and **claimed** and nothing else. The rule is an allowlist rather than "not unclaimed": a status these surfaces do not recognise must fall off the roster, never onto it as an anonymous line someone could tick off at the door. The QR scan is gated differently, on the Ticket's own Credential and Cancellation rather than on Slot Status.

### Claim
Putting a named person onto an **issued** Ticket, which turns it **claimed**. Claims happen at checkout when the buyer names their party, when a Top-up adds and names further Tickets, and at the door when staff name a walk-up. Correcting the name on an already-claimed Ticket is an edit, not a Claim.

A holder's identity for this purpose is **name plus contact plus Ticket Type**, and all three carry weight. Two claims matching on all three are one claim arriving twice — the second is absorbed and consumes nothing, which is what makes a retried or redelivered purchase safe. Differing in any one of them makes it a distinct claim: two people sharing one email are two holders (see Household), and one person holding two Ticket Types is one holder who bought two things, as on a multi-day Event. Narrowing that identity to fewer dimensions silently merges holders or purchases that were never the same, and the merged party keeps its Seat while losing its name. A Ticket left **issued** cannot be admitted until someone names it at the door: the scan stops and asks rather than letting an anonymous holder through, which is the last place such a loss can still be caught.

### Booking Page
Formerly the Lead's self-service page for a whole Registration; now retired for ordinary Registrations, whose old links redirect to the payer's own Household page. It survives only for a Guest List, since it remains the only surface rendering a contactless comp guest's QR and the sponsor's own paid seats — a comp-only carve-out pending its own deletion once no live comp sponsor link still points at an upcoming Event.

### Household
The set of live Tickets within one Registration that share the same email address — a couple or a family who booked together on one address. The Household is the unit of Ticket delivery and self-service: its Tickets arrive as one grouped email carrying every QR, and are managed together — including buying more Tickets onto the Registration — through any one member's Manage Link.

### Manage Link
The private, rotatable per-Ticket link that opens a Ticket's Household — letting whoever holds it view every QR at that address, correct a name, email or phone, upgrade (see Conversion), buy more (see Top-up), cancel (see Cancellation), or accept the Waiver ahead of the Event. Distinct from the Ticket Credential: the Manage Link governs the booking, the Credential only admits at the door. Rotating a Manage Link revokes the old one for the whole Household. The Lead's own Manage Link additionally reaches the Receipt Page.

### Receipt Page
The Lead's read-only purchase history, reached from their own Manage Link — every purchase they have made across every Event, newest first, itemised from the Registration's own recorded lines rather than the payment provider's hosted receipt. Gated on whether the Ticket the link resolves to is the Lead's, not on its email address — an ordinary holder can rewrite their own Ticket's address (see Manage Link), so gating on email alone would let them read another person's spend by editing their address to match.

### Door Console
The public, no-login check-in surface for an Event, opened by staff at a hard-to-guess per-Event link, used to scan Ticket QRs, fill in missing names and waivers, admit walk-ups against unredeemed Tickets, and resend a party's Tickets to its Lead.

## Membership applications

### Approval Committee
The admins who decide on membership applications — a named subset of staff, not every admin. Notifications about pending applications go to this set, and it is the reason "notify the admins" and "notify the committee" are different actions in this codebase.

### Authorization Hold
A card authorization taken at application time without charging it — the money is reserved, not captured. An application on a paid tier reaches the Approval Committee only once its hold succeeds, so an abandoned checkout never becomes something a human has to triage. The charge is captured later, on approval; a decline releases the hold instead.

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

- **"Expected"** once meant two different numbers — the admin read it as live Seats, the door totalled booked quantities including cancelled ones. Settled: both now net cancellations, so the door's expected headcount and the admin's live figure answer the same question. What remains between them is genuine data disagreement, reported as Unaccounted rather than hidden.
- **"Attendee"** is retired in favour of **Ticket** — see that entry.
- **"Pre-registered"** was retired as a concept. Every Seat is named at purchase, so there is no separate un-named-but-expected population.
