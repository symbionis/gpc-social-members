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
}

/**
 * Everything here counts TICKETS, and the figures reconcile two ways:
 *
 *   paid + free + guest list = booked
 *   booked − cancelled       = active
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
  hasSeatCap: boolean;
  seatCap: number | null;
  overbooked: boolean;
  ticketTypeSummary: TicketTypeSummaryRow[];
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
  hasSeatCap,
  seatCap,
  overbooked,
  ticketTypeSummary,
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
      </div>

      {/* Per-ticket-type breakdown — ticket count leads, pre-registered beneath. */}
      {ticketTypeSummary.length > 0 && (
        <div>
          <p className="mb-2 font-body text-sm font-bold text-marine">Ticket types</p>
          <div className="flex flex-wrap gap-3">
            {ticketTypeSummary.map((tt) => (
              <Panel
                key={tt.id}
                value={String(tt.sold)}
                label={tt.title || "Untitled"}
                sub={priceLabel(tt.priceMember, tt.priceNonMember)}
              >
                {!tt.countsAsSeat && (
                  <span className="rounded-full bg-sky/10 px-2 py-0.5 text-[10px] font-body text-sky-dark">
                    No seat
                  </span>
                )}
              </Panel>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
