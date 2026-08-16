/**
 * Event overview: headline seat panels plus a per-ticket-type breakdown, each leading with its
 * count. Pure presentational (no hooks, no client APIs) so it renders inside the client
 * ManageEventTabs without a "use client" boundary.
 *
 * There is no "pre-registered" figure. It counted seats whose holder had been named, which
 * mattered when naming happened after booking; every ticket is named at checkout now, so the
 * number only ever restated the seat count — or, on legacy events, quietly disagreed with it.
 */

import type { ReactNode } from "react";

export interface TicketTypeSummaryRow {
  id: string;
  title: string;
  priceMember: number | null;
  priceNonMember: number | null;
  countsAsSeat: boolean;
  /** Tickets purchased of this type (event_registration_items by ticket_type_id). */
  sold: number;
  /**
   * Guest-list guests of this type, NET of anyone who already holds a purchased ticket of it
   * (U9's `findGuestListOverlap` — same person, same type, counted once as purchased). Optional
   * so a call site that has not been updated yet still compiles and this simply adds nothing.
   */
  guestListSold?: number;
}

/**
 * Everything here counts TICKETS, and the figures reconcile as:
 *
 *   paid + free + guest list  = booked
 *   (paid + free) − cancelled = active
 *
 * Note what the second identity does NOT include. `active` comes from `seats_used`, which
 * counts registrations and their line items — a guest-list ticket has neither (KD10), so it
 * is structurally invisible to that figure (KTD4). `booked − cancelled` would therefore
 * overshoot `active` by exactly the guest-list count on any event that has one, which is
 * why the cancelled figure is derived as `(paid + free) − active` and never `booked −
 * active`. See lib/events/booked-tickets.ts (`cancelledFromSplit`).
 *
 * The split matters because "sold" used to mean "booked" and swept comps in with it, so an
 * event with a guest list reported seats as sold that the club had never been paid for.
 */
interface Props {
  /** Tickets still standing — `seats_used`, i.e. booked minus cancelled. Drives the cap warning. */
  total: number;
  /** Every ticket booked, cancellations included: paid + free + guest list. */
  booked: number;
  /** Tickets PAID FOR, cancellations included — the money figure. */
  paidTickets: number;
  /** True when the active count could not be read, so the figures cannot be reconciled. */
  figuresDegraded?: boolean;
  /** Tickets on free bookings that are not a guest list (a free event, or a zero-priced type). */
  freeTickets: number;
  /** Tickets given back — DERIVED as `booked − active`, not counted, so it absorbs any
   * disagreement between those two figures. Shown so booked and active visibly reconcile. */
  cancelledSeats: number;
  /** Comp tickets across every guest list, cancellations included. */
  guestListSeats: number;
  /** How many sponsors hold a list, which is what makes the seat figure readable. */
  guestListCount: number;
  /**
   * Guest-list guests who have checked in — the "admitted" half of the R14 pair (guests on
   * lists, guests admitted). Deliberately its own figure, never folded into the ticketed
   * check-in rate below (KTD11): a guest-list guest has no registration, so counting their
   * arrival against a ticketed denominator would push the rate past 100%.
   */
  guestListAdmitted?: number;
  hasSeatCap: boolean;
  seatCap: number | null;
  overbooked: boolean;
  ticketTypeSummary: TicketTypeSummaryRow[];
  /**
   * Checked-in tickets that trace back to a registration — i.e. excludes every guest-list
   * ticket (KTD11). Paired with `total` (already purely ticketed — `seats_used` never reads
   * `tickets` at all) to compute the check-in rate. Optional and undefined by default so a
   * call site that has not been updated yet renders with no rate panel, rather than a
   * misleading 0%.
   */
  checkedInTickets?: number;
}

function formatPrice(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "Free";
  return `CHF ${n.toFixed(2)}`;
}

function priceLabel(member: number | null, nonMember: number | null): string {
  // Collapse to a single price when members and non-members pay the same.
  if (member === nonMember) return formatPrice(member);
  return `${formatPrice(member)} / ${formatPrice(nonMember)}`;
}

/** Panel shell: a big number leads, a readable label and grey sub-line sit below. */
function Panel({
  value,
  label,
  sub,
  tone = "default",
  children,
}: {
  value: string;
  label: string;
  sub?: string;
  tone?: "default" | "alert";
  children?: ReactNode;
}) {
  const valueClass = tone === "alert" ? "text-red-700" : "text-marine";
  return (
    <div className="rounded-lg border border-border bg-cream/30 px-4 py-3 min-w-[8rem]">
      <div className={`font-heading text-2xl font-bold leading-none ${valueClass}`}>
        {value}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-body text-[13px] font-semibold text-marine">{label}</span>
        {children}
      </div>
      {sub ? (
        <div className="mt-0.5 font-body text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

export default function EventRosterSummary({
  total,
  booked,
  figuresDegraded = false,
  paidTickets,
  freeTickets,
  cancelledSeats,
  guestListSeats,
  guestListCount,
  guestListAdmitted = 0,
  hasSeatCap,
  seatCap,
  overbooked,
  ticketTypeSummary,
  checkedInTickets,
}: Props) {
  // Worth showing only when booked says something active does not: a cancellation happened,
  // or the tickets came from more than one place (paid, free, a guest list).
  const categories = [paidTickets, freeTickets, guestListSeats].filter((n) => n > 0);
  // Never claim a reconciliation we could not compute: with the active count unavailable,
  // `cancelled` collapses to 0 and the panels would read as a clean, fully-reconciled event.
  const showBreakdown = !figuresDegraded && (cancelledSeats > 0 || categories.length > 1);

  const capacitySub = hasSeatCap
    ? overbooked
      ? `of ${seatCap} cap — overbooked`
      : `of ${seatCap} cap`
    : "Uncapped";

  // KTD11: checked-in ÷ registered, both purely ticketed. `total` already structurally
  // excludes guest-list tickets (`seats_used` never reads `tickets`); `checkedInTickets` is the
  // caller's job to exclude the same way (registration-backed tickets only). Rendered only when
  // the caller has supplied a real figure — undefined means "not wired yet", not "0%".
  const showCheckInRate = checkedInTickets !== undefined;
  const checkInRatePct =
    showCheckInRate && total > 0 ? Math.round(((checkedInTickets as number) / total) * 100) : 0;

  return (
    <div className="flex-1 min-w-0 space-y-5">
      {/* No "Overview" heading of its own — this renders under the tab of that name, and
          repeating it would label the same thing twice. */}

      {/* Active tickets lead: that is the number the cap, the waitlist and public registration
          all reason about. The rest appear only when they add something — on a straightforward
          paid event with no cancellations, active/booked/paid are one number said three times. */}
      <div className="flex flex-wrap gap-3">
        <Panel
          value={String(total)}
          label="Active tickets"
          sub={capacitySub}
          tone={overbooked ? "alert" : "default"}
        />
        {/* R19/KTD11: checked-in ÷ registered, purely ticketed on both sides. Shown only once a
            caller supplies `checkedInTickets` — undefined means the figure has not been wired
            up yet, not that check-in stands at 0%. */}
        {showCheckInRate && (
          <Panel
            value={`${checkInRatePct}%`}
            label="Checked in"
            sub={`${checkedInTickets} of ${total} ticketed`}
          />
        )}
        {showBreakdown && (
          <>
            <Panel value={String(booked)} label="Booked tickets" sub="before cancellations" />
            {paidTickets > 0 && <Panel value={String(paidTickets)} label="Paid tickets" />}
            {freeTickets > 0 && <Panel value={String(freeTickets)} label="Free tickets" />}
          </>
        )}
        {cancelledSeats > 0 && (
          <Panel value={String(cancelledSeats)} label="Cancelled tickets" sub="see Refunds" />
        )}
        {/* Comped tickets, shown only when a list exists. A guest list mints ordinary tickets,
            so its people sit in the attendee roster indistinguishable from buyers unless the
            organiser opens the pill or the Guest list tab — this is what names them.

            The figure counts comp tickets, INCLUDING each list's sponsor lead, because that is
            what both the Guest list tab and the attendee roster already count. Splitting the
            lead out here would put a third number on the same population. */}
        {guestListCount > 0 && (
          <Panel
            value={String(guestListSeats)}
            label="Guest list tickets"
            sub={`across ${guestListCount} guest list${guestListCount === 1 ? "" : "s"}`}
          />
        )}
        {/* R14: guest-list attendance is its own pair, deliberately never folded into the
            ticketed check-in rate above (KTD11) — a guest-list guest has no registration to be
            "checked in" against. Sibling of the panel above rather than merged into it, so
            "on the list" and "admitted" stay two separately-readable numbers. */}
        {guestListCount > 0 && (
          <Panel
            value={String(guestListAdmitted)}
            label="Guest list admitted"
            sub={`of ${guestListSeats} on list${guestListSeats === 1 ? "" : "s"}`}
          />
        )}
      </div>

      {/* Per-ticket-type breakdown — ticket count leads, pre-registered beneath. */}
      {ticketTypeSummary.length > 0 && (
        <div>
          <p className="mb-2 font-body text-sm font-bold text-marine">Ticket types</p>
          <div className="flex flex-wrap gap-3">
            {ticketTypeSummary.map((tt) => {
              // R14: the headline figure is purchased UNION guest-list, so an admin reading
              // one number sees everyone who will actually show up holding this type — not
              // just the ones the club was paid for. `guestListSold` already nets out anyone
              // who also holds a purchased ticket of this same type (findGuestListOverlap), so
              // that person is not counted twice here.
              const guestListSold = tt.guestListSold ?? 0;
              return (
                <Panel
                  key={tt.id}
                  value={String(tt.sold + guestListSold)}
                  label={tt.title || "Untitled"}
                  sub={priceLabel(tt.priceMember, tt.priceNonMember)}
                >
                  {!tt.countsAsSeat && (
                    <span className="rounded-full bg-sky/10 px-2 py-0.5 text-[10px] font-body text-sky-dark">
                      No seat
                    </span>
                  )}
                  {guestListSold > 0 && (
                    <span className="rounded-full bg-sky/10 px-2 py-0.5 text-[10px] font-body text-sky-dark">
                      incl. {guestListSold} guest list
                    </span>
                  )}
                </Panel>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
