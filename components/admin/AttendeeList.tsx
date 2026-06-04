"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { formatDateTime } from "@/lib/format";
import { formatTicketBreakdown, type TicketTypeLine } from "@/lib/events/tickets";
import type { PartyDetail } from "@/lib/events/roster-fill";

/** One person on the roster (event_attendees, claimed slots). */
interface Attendee {
  id: string;
  registrationId: string | null;
  name: string;
  email: string;
  phone_e164: string;
  isMember: boolean;
  isLead: boolean;
  /** The lead's name for this party when the attendee is a guest, else "". */
  leadName: string;
  /** Tickets purchased for this party — present on the lead row only (null elsewhere). */
  ticketCount: number | null;
  /** Per-ticket-type breakdown for the lead's party; empty for guests / no party. */
  ticketBreakdown: TicketTypeLine[];
  /** Party self-reg detail (fill + token) on lead rows; null otherwise. */
  party: PartyDetail | null;
  waiverSigned: boolean;
  checkedIn: boolean;
  arrivedAt: string | null;
  createdAt: string;
}

interface Props {
  attendees: Attendee[];
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); falls back to window origin. */
  baseUrl: string;
  eventId: string;
}

type MemberFilter = "all" | "members" | "non_members";
type PartyFilter = "all" | "incomplete";

const COLSPAN = 8;

export default function AttendeeList({ attendees, baseUrl, eventId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [partyFilter, setPartyFilter] = useState<PartyFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);

  // Registrations whose party still has open slots — drives the "unfilled" filter
  // for both the lead and its guest rows.
  const incompleteRegs = useMemo(() => {
    const s = new Set<string>();
    for (const a of attendees) {
      if (a.isLead && a.registrationId && a.party && a.party.remaining > 0) {
        s.add(a.registrationId);
      }
    }
    return s;
  }, [attendees]);

  // Order rows as lead-then-its-guests per party, then registration-less rows —
  // so guests render as sub-rows under their lead.
  const ordered = useMemo(() => {
    const leads: Attendee[] = [];
    const guestsByReg = new Map<string, Attendee[]>();
    const standalone: Attendee[] = [];
    for (const a of attendees) {
      if (a.isLead && a.registrationId) leads.push(a);
      else if (a.registrationId) {
        const list = guestsByReg.get(a.registrationId) ?? [];
        list.push(a);
        guestsByReg.set(a.registrationId, list);
      } else standalone.push(a);
    }
    const out: Attendee[] = [];
    for (const lead of leads) {
      out.push(lead);
      out.push(...(guestsByReg.get(lead.registrationId as string) ?? []));
    }
    // Guests whose lead row is missing (lead not seeded) still surface, grouped.
    for (const [reg, guests] of guestsByReg) {
      if (!leads.some((l) => l.registrationId === reg)) out.push(...guests);
    }
    return [...out, ...standalone];
  }, [attendees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((a) => {
      if (memberFilter === "members" && !a.isMember) return false;
      if (memberFilter === "non_members" && a.isMember) return false;
      if (partyFilter === "incomplete" && !(a.registrationId && incompleteRegs.has(a.registrationId)))
        return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone_e164.toLowerCase().includes(q)
      );
    });
  }, [ordered, query, memberFilter, partyFilter, incompleteRegs]);

  const isFiltering =
    query.trim() !== "" || memberFilter !== "all" || partyFilter !== "all";

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      /* clipboard blocked — the link is still selectable in the field */
    }
  }

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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or phone"
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
        <div className="flex items-center gap-2">
          <label className="text-xs font-body text-muted-foreground">Parties</label>
          <select
            value={partyFilter}
            onChange={(e) => setPartyFilter(e.target.value as PartyFilter)}
            className="px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm cursor-pointer"
          >
            <option value="all">All</option>
            <option value="incomplete">Unfilled slots</option>
          </select>
        </div>
      </div>

      {isFiltering && (
        <p className="text-xs font-body text-muted-foreground">
          Showing {filtered.length} of {attendees.length} attendee
          {attendees.length === 1 ? "" : "s"}
        </p>
      )}

      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
          {attendees.length === 0
            ? "No attendees yet."
            : partyFilter === "incomplete"
              ? "No parties with unfilled slots."
              : "No attendees match your search."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead className="bg-cream/60 text-marine">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Name</th>
                  <th className="text-left px-4 py-3 font-semibold">Contact</th>
                  <th className="text-left px-4 py-3 font-semibold">Member</th>
                  <th className="text-left px-4 py-3 font-semibold">Party / Lead</th>
                  <th className="text-left px-4 py-3 font-semibold">Tickets</th>
                  <th className="text-left px-4 py-3 font-semibold">Waiver</th>
                  <th className="text-left px-4 py-3 font-semibold">Arrived</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isGuest = !row.isLead && !!row.registrationId;
                  const isOpen = expanded.has(row.id);
                  const party = row.party;
                  const selfRegUrl =
                    party?.selfRegToken
                      ? `${origin}/public/registrations/${party.selfRegToken}`
                      : "";
                  return (
                    <RosterRow
                      key={row.id}
                      row={row}
                      isGuest={isGuest}
                      isOpen={isOpen}
                      selfRegUrl={selfRegUrl}
                      copiedId={copiedId}
                      removing={removing.has(row.id)}
                      onToggle={() => toggle(row.id)}
                      onCopy={copyLink}
                      onRemove={removeGuest}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RosterRow({
  row,
  isGuest,
  isOpen,
  selfRegUrl,
  copiedId,
  removing,
  onToggle,
  onCopy,
  onRemove,
}: {
  row: Attendee;
  isGuest: boolean;
  isOpen: boolean;
  selfRegUrl: string;
  copiedId: string | null;
  removing: boolean;
  onToggle: () => void;
  onCopy: (id: string, url: string) => void;
  onRemove: (id: string, name: string) => void;
}) {
  const party = row.party;
  const canExpand = party !== null && !!selfRegUrl && party.remaining > 0;

  return (
    <>
      <tr className={`border-t border-border ${isGuest ? "bg-cream/20" : ""}`}>
        <td className={`px-4 py-3 text-marine ${isGuest ? "pl-10" : ""}`}>
          {canExpand ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              className="flex items-center gap-2 text-left cursor-pointer hover:text-marine-light"
            >
              <span
                aria-hidden
                className={`text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
              >
                ▸
              </span>
              <span>{row.name || "—"}</span>
            </button>
          ) : (
            <span className="flex items-center gap-2">
              {isGuest && <span aria-hidden className="text-muted-foreground">↳</span>}
              {row.name || "—"}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          <div className="flex flex-col gap-0.5">
            {row.email && <span>{row.email}</span>}
            {row.phone_e164 && <span className="font-mono text-xs">{row.phone_e164}</span>}
            {!row.email && !row.phone_e164 && <span>—</span>}
          </div>
        </td>
        <td className="px-4 py-3">
          {row.isMember ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Yes</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">No</span>
          )}
        </td>
        <td className="px-4 py-3 text-marine">
          {row.isLead ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-sky/10 text-sky-dark">Lead</span>
          ) : row.leadName ? (
            <span className="text-xs text-muted-foreground">Guest of {row.leadName}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {row.ticketCount != null ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-marine font-semibold">{row.ticketCount}</span>
              {party && (
                <span
                  className={`text-xs ${party.remaining > 0 ? "text-amber-700" : "text-emerald-700"}`}
                >
                  {party.claimedCount}/{party.quantity} registered
                </span>
              )}
              {row.ticketBreakdown.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {formatTicketBreakdown(row.ticketBreakdown)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {row.waiverSigned ? (
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
          {isGuest && !row.checkedIn && (
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

      {isOpen && party && selfRegUrl && (
        <tr className="bg-cream/30 border-t border-border">
          <td colSpan={COLSPAN} className="px-4 py-4">
            <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
              <div>
                <p className="text-xs font-body text-muted-foreground mb-1">
                  Share this link so guests register themselves
                  {party.remaining > 0 ? ` (${party.remaining} open):` : ":"}
                </p>
                <div className="flex gap-2 max-w-md">
                  <input
                    readOnly
                    value={selfRegUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-white text-marine font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => onCopy(row.id, selfRegUrl)}
                    className="px-3 py-2 bg-marine text-white rounded-lg text-xs font-body font-medium hover:bg-marine-light transition-colors cursor-pointer"
                  >
                    {copiedId === row.id ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-border w-fit">
                <QRCodeCanvas value={selfRegUrl} size={120} marginSize={2} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
