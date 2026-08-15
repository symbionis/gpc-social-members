"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { bySurname, surnameKey } from "@/lib/events/roster-sort";

/**
 * One LIVE ticket on the roster (U15). Claimed (named) and still-`issued` (unnamed) alike
 * (R25), grouped by lowercased email address (R26) rather than by booking/lead.
 *
 * Cancelled seats are excluded upstream and never reach this component — they are money work,
 * and they live in the event's Refunds tab. The roster answers one question, "who is arriving",
 * and a seat that was cancelled is not an answer to it. Nothing about door safety rests on this
 * display: check-in rejects a cancelled ticket at the scan (lib/events/checkin.ts), and the
 * printed door sheet marks them separately.
 */
export interface Attendee {
  id: string;
  registrationId: string | null;
  referenceCode: string | null;
  /** "" when the ticket is still unnamed (issued). */
  name: string;
  /** "" when the ticket is still unnamed (issued). Lowercased grouping happens in-component. */
  email: string;
  phone_e164: string;
  isMember: boolean;
  isLead: boolean;
  /** This ticket's own type title (e.g. the asado meal); "" when none. */
  ticketTypeTitle: string;
  /** This ticket's own manage_token → the household manage page (/public/tickets/<token>). */
  manageToken: string | null;
  /**
   * Whether this ticket's holder has been emailed their QR — the lead rides the booking
   * confirmation (registration.ticket_email_sent_at), guests ride the grouped household
   * email (tickets.qr_email_sent_at). Resolved on the server; false for unnamed tickets.
   */
  notified: boolean;
  waiverSigned: boolean;
  checkedIn: boolean;
  arrivedAt: string | null;
  createdAt: string;
  /**
   * What this seat cost, in CHF — the same valuation the refund button quotes, so the roster
   * and the refund cannot disagree about one seat. 0 for any ticket on a free booking (a
   * historical comp included, since comp is retired and its registration is itself `free`),
   * which is why a zero renders as nothing rather than as "CHF 0.00".
   */
  priceChf: number;
  /**
   * How this seat was obtained, which the roster shows because "did they pay?" is a question
   * the door and the organiser both ask and neither could answer from here before:
   *  - `paid` — bought through checkout on a paid booking
   *  - `free` — a booking that cost nothing (a free event, a zero-price offer redemption, a
   *    historical waitlist comp from before the paid offer flow, or a historical sponsor
   *    guest-list seat — comp is retired, R16/KD7, and a comped seat is now indistinguishable
   *    on this roster from any other free booking)
   */
  paymentState: "paid" | "free";
  /** Whether anyone is named on this ticket yet (slot_status === 'claimed'). */
  named: boolean;
}

interface Props {
  attendees: Attendee[];
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); falls back to window origin. */
  baseUrl: string;
  eventId: string;
}

type MemberFilter = "all" | "members" | "non_members";

/**
 * One row on the flat roster: a single ticket, plus the other tickets sharing its address.
 *
 * The roster used to be grouped BY address, with the email as the card header. That put a
 * delivery mechanic — the grouped ticket email goes to one mailbox — in charge of an
 * operational surface whose only question is "is this person on the list?". A guest sharing
 * their partner's address was findable only by first knowing whose address it was.
 *
 * So every ticket now gets its own row, ordered by surname exactly as the printed door sheet
 * and the door console order theirs (lib/events/roster-sort). The household survives as a
 * cross-reference: where an address carries more than one ticket, the row expands to show who
 * else is on it. Each of those people still has their own row elsewhere in the list — the
 * expander answers "who are they here with?", it does not hide anyone inside it.
 */
interface RosterRow {
  ticket: Attendee;
  /** Other live tickets sharing this ticket's address. Empty for a solo holder or no email. */
  household: Attendee[];
  /** Sort key, precomputed so the comparator stays pure. */
  sort: { last: string; first: string; bookingRef: string; named: boolean };
}

// Every ticket becomes a row. Tickets WITH an email also learn who shares it (lowercased, the
// same key household delivery uses, so the roster and the email agree on what one address is).
// A ticket with no email has no household by definition — a comp guest or phone-only walk-up
// is not "in a household of one", they simply have no address to share.
function buildRows(attendees: Attendee[]): RosterRow[] {
  const byAddress = new Map<string, Attendee[]>();
  for (const a of attendees) {
    const key = a.email.trim().toLowerCase();
    if (!key) continue;
    const list = byAddress.get(key) ?? [];
    list.push(a);
    byAddress.set(key, list);
  }

  const rows = attendees.map<RosterRow>((ticket) => {
    const key = ticket.email.trim().toLowerCase();
    const mates = key ? (byAddress.get(key) ?? []).filter((t) => t.id !== ticket.id) : [];
    return {
      ticket,
      household: mates,
      sort: surnameKey(ticket.name || null, ticket.referenceCode, ticket.named),
    };
  });

  rows.sort((a, b) => bySurname(a.sort, b.sort));
  return rows;
}

export default function AttendeeList({ attendees, baseUrl, eventId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  // Addresses whose grouped email is being resent — keyed by lowercased email.
  const [resending, setResending] = useState<Set<string>>(new Set());
  // Rows whose household cross-reference is open, keyed by ticket id.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);

  const rows = useMemo(() => buildRows(attendees), [attendees]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(({ ticket }) => {
      if (memberFilter === "members" && !ticket.isMember) return false;
      if (memberFilter === "non_members" && ticket.isMember) return false;
      if (!q) return true;
      return (
        ticket.name.toLowerCase().includes(q) ||
        ticket.email.toLowerCase().includes(q) ||
        ticket.phone_e164.toLowerCase().includes(q) ||
        (ticket.referenceCode ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, memberFilter]);

  const isFiltering = query.trim() !== "" || memberFilter !== "all";

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Resend the grouped ticket email to ONE address — every QR at that address, in one email.
  // Still per-address even though the roster is now per-person: the grouped email IS the
  // delivery unit, so resending from either housemate's row sends the same one email. The
  // button sits on the row because that is where the admin is looking.
  async function resendAddress(email: string) {
    const key = email.trim().toLowerCase();
    if (!key) return;
    setError(null);
    setNotice(null);
    setResending((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/admin/events/${eventId}/resend-household`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not resend the tickets.");
        return;
      }
      setNotice(`Tickets resent to ${email}.`);
      router.refresh();
    } catch {
      setError("Could not resend the tickets.");
    } finally {
      setResending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone or reference"
          className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-body text-muted-foreground">Member</label>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value as MemberFilter)}
            className="px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm cursor-pointer"
          >
            <option value="all">All</option>
            <option value="members">Members</option>
            <option value="non_members">Non-members</option>
          </select>
        </div>
      </div>

      {isFiltering && (
        <p className="text-xs font-body text-muted-foreground">
          Showing {filteredRows.length} of {attendees.length} ticket
          {attendees.length === 1 ? "" : "s"}
        </p>
      )}

      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {notice && (
        <p className="text-sm font-body text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {notice}
        </p>
      )}

      {filteredRows.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
          {attendees.length === 0 ? "No tickets sold yet." : "No tickets match your search."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead className="text-marine bg-cream/60 border-b border-border">
                <tr className="text-left">
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Ticket</th>
                  <th className="px-4 py-2 font-semibold">Member</th>
                  <th className="px-4 py-2 font-semibold">Waiver</th>
                  <th className="px-4 py-2 font-semibold">Arrived</th>
                  <th className="px-4 py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <TicketRow
                    key={row.ticket.id}
                    row={row}
                    origin={origin}
                    expanded={expanded.has(row.ticket.id)}
                    onToggle={() => toggleExpanded(row.ticket.id)}
                    resending={resending.has(row.ticket.email.trim().toLowerCase())}
                    onResend={resendAddress}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Only one state worth a pill. A `free` seat gets none: on a free event that was every row, so
// the pill marked nothing and only added noise — and, since comp is retired (R16/KD7), a
// historical sponsor guest-list seat now folds into `free` too, rather than earning its own
// "Special Guest" pill. What a seat cost is now answered by the price under its ticket type,
// which says more than a pill could — and says nothing at all when there was no money, which is
// the correct amount to say.
function PaymentPill({ state }: { state: Attendee["paymentState"] }) {
  if (state === "paid") {
    return (
      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700">
        Paid
      </span>
    );
  }
  return null;
}

function TicketRow({
  row,
  origin,
  expanded,
  onToggle,
  resending,
  onResend,
}: {
  row: RosterRow;
  origin: string;
  expanded: boolean;
  onToggle: () => void;
  resending: boolean;
  onResend: (email: string) => void;
}) {
  const { ticket, household } = row;
  const hasHousehold = household.length > 0;
  const manageUrl = ticket.manageToken ? `${origin}/public/tickets/${ticket.manageToken}` : "";

  return (
    <>
      <tr data-testid="ticket-row" className="border-t border-border align-top">
        <td className="px-4 py-3 text-marine">
          <span className="flex items-center gap-2 flex-wrap">
            {/* The expander is the only affordance on the name, so it reads as "there is more
                about this person" rather than as a row-level disclosure of the whole table. */}
            {hasHousehold && (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? `Hide who shares ${ticket.email}`
                    : `Show the ${household.length + 1} people sharing ${ticket.email}`
                }
                data-testid="household-toggle"
                className="text-marine/60 hover:text-marine transition-colors cursor-pointer text-xs w-4 shrink-0"
              >
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <span>
              {ticket.name || <span className="text-muted-foreground italic">Unnamed</span>}
            </span>
            {ticket.isLead && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-sky/10 text-sky-dark">
                Buyer
              </span>
            )}
            <PaymentPill state={ticket.paymentState} />
            {ticket.named && !ticket.notified && ticket.email && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800">
                Not notified
              </span>
            )}
          </span>
          {/* Address and phone are metadata on the person now, not the thing they live under. */}
          {ticket.email && (
            <span className="block text-[11px] text-muted-foreground truncate">
              {ticket.email}
              {hasHousehold && ` · +${household.length}`}
            </span>
          )}
          {ticket.phone_e164 && (
            <span className="block font-mono text-[11px] text-muted-foreground">
              {ticket.phone_e164}
            </span>
          )}
          {ticket.referenceCode && (
            <span className="block font-mono text-[11px] text-muted-foreground">
              {ticket.referenceCode}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {ticket.ticketTypeTitle ? (
            <span className="text-xs text-marine">{ticket.ticketTypeTitle}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          {/* What the seat cost, under its type. Suppressed at zero rather than shown as
              "CHF 0.00": a comp and a free booking both land there, and both already say so
              beside the name. */}
          {ticket.priceChf > 0 && (
            <span className="block text-[11px] text-muted-foreground tabular-nums">
              {formatCurrency(ticket.priceChf, { decimals: 2 })}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {ticket.isMember ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">
              Yes
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">No</span>
          )}
        </td>
        <td className="px-4 py-3">
          {!ticket.named ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : ticket.waiverSigned ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">
              Signed
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
              Unsigned
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {ticket.checkedIn ? (
            <div className="flex flex-col gap-0.5">
              <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800 w-fit">
                In
              </span>
              {ticket.arrivedAt && (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(ticket.arrivedAt)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 justify-end">
            {manageUrl && (
              <a
                href={manageUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open this person's manage page (QR codes, upgrade, correct details)"
                className="px-2.5 py-1 rounded-lg border border-marine/40 text-marine text-xs font-body hover:bg-marine hover:text-white transition-colors whitespace-nowrap"
              >
                Manage ↗
              </a>
            )}
            {ticket.email && (
              <button
                type="button"
                onClick={() => onResend(ticket.email)}
                disabled={resending}
                aria-label={`Resend tickets to ${ticket.email}`}
                title="Resend the ticket email to this address (every QR on it, in one email)"
                className="px-2.5 py-1 rounded-lg border border-marine/40 text-marine text-xs font-body hover:bg-marine hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {resending ? "Resending…" : "Resend"}
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* The cross-reference: who else is on this address. Each of these has their own row in
          the list too — this answers "who are they here with?" without hiding anyone. */}
      {expanded && hasHousehold && (
        <tr data-testid="household-detail" className="border-t border-border/50 bg-cream/40">
          <td colSpan={6} className="px-4 py-3">
            <p className="text-xs font-body text-muted-foreground mb-1.5">
              Shares {ticket.email} with:
            </p>
            <ul className="space-y-1">
              {household.map((mate) => (
                <li key={mate.id} className="flex items-center gap-2 flex-wrap text-xs text-marine">
                  <span>
                    {mate.name || <span className="text-muted-foreground italic">Unnamed</span>}
                  </span>
                  {mate.isLead && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-sky/10 text-sky-dark">
                      Buyer
                    </span>
                  )}
                  <PaymentPill state={mate.paymentState} />
                  {mate.ticketTypeTitle && (
                    <span className="text-muted-foreground">{mate.ticketTypeTitle}</span>
                  )}
                  {mate.checkedIn && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800">
                      In
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
