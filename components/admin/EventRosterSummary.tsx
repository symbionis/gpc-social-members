/**
 * Roster-tab header: two headline panels (total tickets, pre-registered) plus a
 * per-ticket-type breakdown rendered as matching panels — each leading with its
 * ticket count, with the pre-registered count smaller beneath. Pure presentational
 * (no hooks, no client APIs) so it renders inside the client ManageEventTabs
 * without a "use client" boundary.
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

interface Props {
  guestsRegistered: number;
  total: number;
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
  guestsRegistered,
  total,
  hasSeatCap,
  seatCap,
  overbooked,
  ticketTypeSummary,
}: Props) {
  const capacitySub = hasSeatCap
    ? overbooked
      ? `of ${seatCap} cap — overbooked`
      : `of ${seatCap} cap`
    : "Uncapped";

  return (
    <div className="flex-1 min-w-0 space-y-5">
      {/* Headline — single-number panels, total first then pre-registered. */}
      <div className="flex flex-wrap gap-3">
        <Panel
          value={String(total)}
          label="Tickets"
          sub={capacitySub}
          tone={overbooked ? "alert" : "default"}
        />
        <Panel value={String(guestsRegistered)} label="Pre-registered" />
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
