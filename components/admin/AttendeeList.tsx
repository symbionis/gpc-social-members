"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";

/**
 * One sold ticket on the roster (U15). The interactive roster now shows EVERY ticket sold —
 * claimed (named) and still-`issued` (unnamed) alike — so its length matches tickets sold
 * (R25), and rows are grouped by lowercased email address (R26) rather than by booking/lead.
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
  /** A comped seat on a guest list — never offer the roster's (door) Remove button for one. */
  isComp: boolean;
  /** Whether anyone is named on this ticket yet (slot_status === 'claimed'). */
  named: boolean;
  /**
   * A holder-cancelled ticket (U14). Rendered struck-through and excluded from the Remove /
   * resend affordances. Always false until cancellation ships; the roster is built to show it
   * distinctly the moment it does.
   */
  cancelled: boolean;
}

interface Props {
  attendees: Attendee[];
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); falls back to window origin. */
  baseUrl: string;
  eventId: string;
}

type MemberFilter = "all" | "members" | "non_members";

/**
 * A group on the roster. `kind` distinguishes the three cases that "no address" used to
 * conflate:
 *  - `address` — an email household (R26): every ticket shares a lowercased email, so it can
 *    be managed and resent as one.
 *  - `booking` — named tickets with NO email (comp-guest-list guests, phone-only): they carry
 *    a real name but no address, so they group by booking, not email, and can't be resent.
 *  - `unnamed` — still-`issued` tickets nobody has named yet.
 */
interface RosterGroup {
  key: string;
  kind: "address" | "booking" | "unnamed";
  /** Display address; "" for booking/unnamed groups. */
  email: string;
  /** Booking reference for the group header (from the earliest ticket that has one). */
  referenceCode: string | null;
  /** Any ticket's manage_token → the shared household manage page (address groups only). */
  manageToken: string | null;
  /** True only when every live (non-cancelled) ticket at the address has been emailed. */
  notified: boolean;
  rows: Attendee[];
}

// Group every sold ticket. A ticket WITH an email joins that household (R26). A ticket without
// one can't have a household — but "no email" is not "unnamed": a claimed comp/phone-only guest
// has a real name and no address (tickets_contact_present allows a named, emailless is_comp row).
// So an emailless ticket groups under its booking, and its `kind` is `booking` when named,
// `unnamed` when still issued — never mislabelled "not named" just for lacking an address. The
// email key mirrors household delivery so the roster, the grouped email, and the per-address
// resend all agree on what one "address" is.
function buildGroups(attendees: Attendee[]): RosterGroup[] {
  const byKey = new Map<string, Attendee[]>();
  for (const a of attendees) {
    const key = a.email
      ? `addr:${a.email.trim().toLowerCase()}`
      : `booking:${a.registrationId ?? a.id}`;
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }

  const groups: RosterGroup[] = [];
  for (const [key, rows] of byKey) {
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const hasAddress = key.startsWith("addr:");
    const kind: RosterGroup["kind"] = hasAddress
      ? "address"
      : rows.every((r) => !r.named)
        ? "unnamed"
        : "booking";
    // A group counts as notified only if every live ticket in it has been emailed — a
    // cancelled ticket carries no obligation, so it doesn't hold the group back.
    const live = rows.filter((r) => !r.cancelled);
    groups.push({
      key,
      kind,
      email: hasAddress ? rows.find((r) => r.email)?.email ?? "" : "",
      referenceCode: rows.find((r) => r.referenceCode)?.referenceCode ?? null,
      // The manage page resolves a household by email, so a token is only actionable for an
      // address group — a booking/unnamed group has no address to open.
      manageToken: hasAddress ? rows.find((r) => r.manageToken)?.manageToken ?? null : null,
      notified: hasAddress && live.length > 0 && live.every((r) => r.notified),
      rows,
    });
  }

  // Email households first (in booking order), then non-addressed bookings.
  groups.sort((a, b) => {
    const au = a.kind !== "address";
    const bu = b.kind !== "address";
    if (au !== bu) return au ? 1 : -1;
    return (a.rows[0]?.createdAt ?? "").localeCompare(b.rows[0]?.createdAt ?? "");
  });
  return groups;
}

export default function AttendeeList({ attendees, baseUrl, eventId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  // Addresses whose grouped email is being resent — keyed by lowercased email.
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);

  const groups = useMemo(() => buildGroups(attendees), [attendees]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => {
        const rows = g.rows.filter((a) => {
          if (memberFilter === "members" && !a.isMember) return false;
          if (memberFilter === "non_members" && a.isMember) return false;
          if (!q) return true;
          return (
            a.name.toLowerCase().includes(q) ||
            a.email.toLowerCase().includes(q) ||
            a.phone_e164.toLowerCase().includes(q) ||
            (g.referenceCode ?? "").toLowerCase().includes(q)
          );
        });
        return { ...g, rows };
      })
      .filter((g) => g.rows.length > 0);
  }, [groups, query, memberFilter]);

  const isFiltering = query.trim() !== "" || memberFilter !== "all";
  const shownCount = filteredGroups.reduce((n, g) => n + g.rows.length, 0);

  async function removeGuest(id: string, name: string) {
    if (!window.confirm(`Remove ${name || "this guest"} and free their slot?`)) return;
    setError(null);
    setRemoving((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/public/door/${eventId}/free-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not remove the guest.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not remove the guest.");
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Resend the grouped ticket email to ONE address — every QR at that address, in one email.
  // Per-address (U15): the roster groups by email, so a resend targets the address the admin
  // is looking at, not the whole booking.
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
          Showing {shownCount} of {attendees.length} ticket{attendees.length === 1 ? "" : "s"}
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

      {filteredGroups.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
          {attendees.length === 0 ? "No tickets sold yet." : "No tickets match your search."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <AddressCard
              key={group.key}
              group={group}
              origin={origin}
              removing={removing}
              resending={resending.has(group.email.trim().toLowerCase())}
              onRemove={removeGuest}
              onResend={resendAddress}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddressCard({
  group,
  origin,
  removing,
  resending,
  onRemove,
  onResend,
}: {
  group: RosterGroup;
  origin: string;
  removing: Set<string>;
  resending: boolean;
  onRemove: (id: string, name: string) => void;
  onResend: (email: string) => void;
}) {
  const isAddress = group.kind === "address";
  const manageUrl =
    isAddress && group.manageToken ? `${origin}/public/tickets/${group.manageToken}` : "";
  const label =
    group.kind === "address"
      ? group.email
      : group.kind === "unnamed"
        ? `Unnamed${group.referenceCode ? ` · booking ${group.referenceCode}` : ""}`
        : `Booking ${group.referenceCode ?? "—"}`;
  const count = group.rows.length;

  return (
    <section
      aria-label={label}
      data-testid="address-group"
      className="bg-white rounded-xl border border-border overflow-hidden"
    >
      <header className="flex items-center gap-3 flex-wrap px-4 py-3 bg-cream/60 border-b border-border">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-body font-semibold text-marine truncate">{label}</span>
          <span className="text-xs font-body text-muted-foreground">
            {count} ticket{count === 1 ? "" : "s"}
            {group.referenceCode && group.kind === "address" ? ` · ${group.referenceCode}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {group.kind === "unnamed" ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 whitespace-nowrap">
              Not named
            </span>
          ) : group.kind === "booking" ? (
            // Named but no email on file → nothing to notify, so say why there's no Resend
            // rather than badging them "Not notified".
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 whitespace-nowrap">
              No email
            </span>
          ) : group.notified ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 whitespace-nowrap">
              Notified
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 whitespace-nowrap">
              Not notified
            </span>
          )}

          {manageUrl && (
            <a
              href={manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this address's manage page (view QR codes, upgrade, correct)"
              className="px-2.5 py-1 rounded-lg border border-marine/40 text-marine text-xs font-body hover:bg-marine hover:text-white transition-colors whitespace-nowrap"
            >
              Manage ↗
            </a>
          )}

          {isAddress && (
            <button
              type="button"
              onClick={() => onResend(group.email)}
              disabled={resending}
              aria-label={`Resend tickets to ${group.email}`}
              title="Resend the grouped ticket email (all QR codes at this address)"
              className="px-2.5 py-1 rounded-lg border border-marine/40 text-marine text-xs font-body hover:bg-marine hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              {resending ? "Resending…" : "Resend"}
            </button>
          )}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead className="text-marine">
            <tr className="text-left">
              <th className="px-4 py-2 font-semibold">Name</th>
              <th className="px-4 py-2 font-semibold">Ticket</th>
              <th className="px-4 py-2 font-semibold">Member</th>
              <th className="px-4 py-2 font-semibold">Waiver</th>
              <th className="px-4 py-2 font-semibold">Arrived</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <TicketRow
                key={row.id}
                row={row}
                removing={removing.has(row.id)}
                onRemove={onRemove}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TicketRow({
  row,
  removing,
  onRemove,
}: {
  row: Attendee;
  removing: boolean;
  onRemove: (id: string, name: string) => void;
}) {
  // The door Remove (free-slot) frees a named guest's slot. Never a lead, a comp seat, a
  // checked-in person, a still-unnamed slot, or a cancelled ticket.
  const canRemove =
    row.named &&
    !row.isLead &&
    !!row.registrationId &&
    !row.checkedIn &&
    !row.isComp &&
    !row.cancelled;

  return (
    <tr data-testid="ticket-row" className="border-t border-border">
      <td className="px-4 py-3 text-marine">
        <span className="flex items-center gap-2">
          <span className={row.cancelled ? "line-through text-muted-foreground" : ""}>
            {row.name || <span className="text-muted-foreground italic">Unnamed</span>}
          </span>
          {row.isLead && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-sky/10 text-sky-dark">
              Buyer
            </span>
          )}
          {row.cancelled && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-red-50 text-red-700">
              Cancelled
            </span>
          )}
        </span>
        {row.phone_e164 && (
          <span className="block font-mono text-[11px] text-muted-foreground">{row.phone_e164}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {row.ticketTypeTitle ? (
          <span className="text-xs text-marine">{row.ticketTypeTitle}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {row.isMember ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Yes</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">No</span>
        )}
      </td>
      <td className="px-4 py-3">
        {!row.named ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : row.waiverSigned ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Signed</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">Unsigned</span>
        )}
      </td>
      <td className="px-4 py-3">
        {row.checkedIn ? (
          <div className="flex flex-col gap-0.5">
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800 w-fit">In</span>
            {row.arrivedAt && (
              <span className="text-xs text-muted-foreground">{formatDateTime(row.arrivedAt)}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(row.id, row.name)}
            disabled={removing}
            className="px-2.5 py-1 rounded-lg border border-red-200 text-red-700 text-xs font-body hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {removing ? "…" : "Remove"}
          </button>
        )}
      </td>
    </tr>
  );
}
