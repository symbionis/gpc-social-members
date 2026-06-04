"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { formatDateTime } from "@/lib/format";
import { formatTicketBreakdown, type TicketTypeLine } from "@/lib/events/tickets";
import type { PartyDetail } from "@/lib/events/roster-fill";

/** One person on the roster (event_attendees, claimed slots). */
interface Attendee {
  id: string;
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
  /** Party self-reg detail (fill + claimed guests + token) on lead rows; null otherwise. */
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
}

type MemberFilter = "all" | "members" | "non_members";
type PartyFilter = "all" | "incomplete";

const COLSPAN = 7;

export default function AttendeeList({ attendees, baseUrl }: Props) {
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [partyFilter, setPartyFilter] = useState<PartyFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Self-reg URLs are built from NEXT_PUBLIC_APP_URL; fall back to the live origin.
  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attendees.filter((a) => {
      if (memberFilter === "members" && !a.isMember) return false;
      if (memberFilter === "non_members" && a.isMember) return false;
      // Incomplete = lead rows whose party still has open slots — the parties to chase.
      if (partyFilter === "incomplete" && !(a.party && a.party.remaining > 0)) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone_e164.toLowerCase().includes(q)
      );
    });
  }, [attendees, query, memberFilter, partyFilter]);

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
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isOpen = expanded.has(row.id);
                  const canExpand = row.party !== null;
                  return (
                    <FragmentRow
                      key={row.id}
                      row={row}
                      isOpen={isOpen}
                      canExpand={canExpand}
                      origin={origin}
                      copiedId={copiedId}
                      onToggle={() => toggle(row.id)}
                      onCopy={copyLink}
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

function FragmentRow({
  row,
  isOpen,
  canExpand,
  origin,
  copiedId,
  onToggle,
  onCopy,
}: {
  row: Attendee;
  isOpen: boolean;
  canExpand: boolean;
  origin: string;
  copiedId: string | null;
  onToggle: () => void;
  onCopy: (id: string, url: string) => void;
}) {
  const party = row.party;
  const selfRegUrl =
    party?.selfRegToken ? `${origin}/public/registrations/${party.selfRegToken}` : "";

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-4 py-3 text-marine">
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
            row.name || "—"
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
      </tr>

      {isOpen && party && (
        <tr className="bg-cream/30 border-t border-border">
          <td colSpan={COLSPAN} className="px-4 py-4">
            <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
              <div>
                <p className="font-body text-sm font-semibold text-marine mb-2">
                  {party.claimedCount} of {party.quantity} registered
                  {party.remaining > 0 ? ` · ${party.remaining} still to come` : " · party full"}
                </p>
                {party.guests.length > 0 ? (
                  <ul className="space-y-1">
                    {party.guests.map((g) => (
                      <li key={g.id} className="flex items-center gap-2 text-sm font-body">
                        <span className="text-marine">{g.name || "—"}</span>
                        <span className="text-xs text-muted-foreground">
                          {g.email || g.phone_e164 || ""}
                        </span>
                        {g.waiverSigned ? (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700">
                            waiver
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800">
                            no waiver
                          </span>
                        )}
                        {g.checkedIn && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800">
                            arrived
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm font-body text-muted-foreground">
                    No guests have self-registered yet.
                  </p>
                )}

                {selfRegUrl && party.remaining > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-body text-muted-foreground mb-1">
                      Share this link so guests register themselves:
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
                )}
              </div>

              {selfRegUrl && party.remaining > 0 && (
                <div className="bg-white p-3 rounded-lg border border-border w-fit">
                  <QRCodeCanvas value={selfRegUrl} size={120} marginSize={2} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
