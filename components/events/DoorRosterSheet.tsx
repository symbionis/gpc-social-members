"use client";

import { Fragment } from "react";
import type { RosterEvent, RosterRow } from "@/lib/events/door-roster";
import { rosterGuestListGroups } from "@/lib/events/door-roster";

interface Props {
  event: RosterEvent;
  rows: RosterRow[];
  typeTotals: Array<{ title: string; qty: number }>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** One row of the sheet: the tickbox, the name (or a blank to write on), its party link,
 * ticket type, contact, and booking ref. Shared by the flat A→Z list and the guest-list
 * sections below it, so the two can never render a person differently. */
function RosterTableRow({ row }: { row: RosterRow }) {
  const lead = row.isLead;
  return (
    <tr className={lead ? "roster-lead" : "roster-guest"}>
      <td className="col-tick">
        <span className="tickbox" aria-hidden />
      </td>
      <td className="col-name">
        {row.named ? (
          <span className={lead ? "name-lead" : "name-guest"}>
            {/* Someone who gave a one-word name has no surname to file
                under. Print the name they gave, not a dangling ", Hallf". */}
            {row.last ? (
              <>
                <span className="surname">{row.last}</span>
                {row.first && <>, {row.first}</>}
              </>
            ) : (
              <span className="surname">{row.first}</span>
            )}
          </span>
        ) : (
          // Nobody has been named on this ticket — a rule to write on.
          <span className="name-blank" aria-label="unnamed guest" />
        )}
        {/* The party link, muted, under the name — so a guest that sorts
            away from its lead is still attributable at the door. */}
        {row.partyLead && <span className="party-label">{row.partyLead}</span>}
      </td>
      <td className="col-type">{row.ticketType}</td>
      <td className="col-contact">{row.phone}</td>
      <td className="col-ref">
        {row.bookingRef}
        {row.tickets && <span className="qty"> ({row.tickets})</span>}
      </td>
    </tr>
  );
}

/**
 * The printed door sheet: every admissible ticket, one line each, in a single flat A→Z list
 * by surname across the whole event — leads and named guests intermixed, so staff can
 * find any named person by their own surname. Each row is self-sufficient (name, ticket
 * type, contact, ref, and a "guest of X" / "lead" label), because a guest now sorts away
 * from their lead. Staff tick the box as each person arrives, so a ticket with no line is
 * a person who cannot be admitted — which is why unnamed guests still get a line, with a
 * rule to write the name on. Those unnamed lines have no surname to sort on, so they
 * trail at the end under a "To fill in" divider.
 *
 * Guest-list guests (U6) are pulled out of that flat list and printed in their own section
 * per list, under the list's name and contact, so staff can work a sponsor's list as a unit
 * ("Cardis brought 12, here they are") instead of hunting for each name scattered through
 * the A→Z sheet under a blank booking ref. They are still real ticket-holders — same row,
 * same tickbox, same contact/type columns — just grouped differently.
 *
 * Rows come from lib/events/door-roster, which is this sheet's only consumer.
 */
export default function DoorRosterSheet({ event, rows, typeTotals }: Props) {
  const totalTickets = rows.length;
  const named = rows.filter((r) => r.named).length;

  // The flat A→Z table shows everyone EXCEPT guest-list guests, who get their own section
  // below (guestListGroups). Filtering preserves the sort order buildDoorRoster already
  // produced, so the "To fill in" logic below still walks the rows in the same order.
  const mainRows = rows.filter((r) => !r.guestListId);
  const guestListGroups = rosterGuestListGroups(rows);

  // The trailing run of unnamed lines is fenced off with a "To fill in" divider — but
  // only when the sheet actually mixes named and unnamed rows. An all-named sheet needs
  // no divider; an all-unnamed sheet (early sales) would show the divider as a stray
  // header above nothing but blanks, so suppress it there too.
  const firstUnnamedIndex = mainRows.findIndex((r) => !r.named);
  const showDivider = mainRows.some((r) => r.named) && firstUnnamedIndex !== -1;

  return (
    <>
      {/* Screen-only toolbar — hidden in print via the .no-print rule. */}
      <div className="no-print flex justify-end gap-3 p-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-marine px-4 py-2 font-body text-sm font-medium text-white transition-colors hover:bg-marine-light"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="roster">
        <header className="roster-head">
          <div className="roster-title">
            <h1 className="font-heading text-xl font-bold text-marine">
              {event.title}
            </h1>
            <p className="font-body text-sm text-marine/70">
              {formatDate(event.start_date)}
            </p>
          </div>
          <div className="roster-counts font-body text-sm text-marine">
            <strong>{totalTickets}</strong> tickets &middot; {named} named &middot;{" "}
            {totalTickets - named} to fill in
          </div>
        </header>

        {/* Catering, on its own full-width line: the type names are long enough that
            squeezing them beside the title overflows the page. */}
        {typeTotals.length > 0 && (
          <ul className="roster-catering font-body">
            {typeTotals.map((t) => (
              <li key={t.title}>
                <strong>{t.qty}</strong> {t.title}
              </li>
            ))}
          </ul>
        )}

        <table className="roster-table font-body">
          <thead>
            <tr>
              <th className="col-tick" scope="col">
                <span aria-hidden>✓</span>
              </th>
              <th className="col-name" scope="col">
                Name
              </th>
              <th className="col-type" scope="col">
                Ticket
              </th>
              <th className="col-contact" scope="col">
                Contact
              </th>
              <th className="col-ref" scope="col">
                Ref
              </th>
            </tr>
          </thead>

          {/* One flat tbody: the list is A→Z across the whole event, no party grouping —
              guest-list guests excepted, who print in their own sections below. */}
          <tbody>
            {mainRows.map((row, i) => (
              <Fragment key={i}>
                {showDivider && i === firstUnnamedIndex && (
                  <tr className="roster-divider">
                    <td className="col-tick" aria-hidden />
                    <td colSpan={4}>To fill in</td>
                  </tr>
                )}
                <RosterTableRow row={row} />
              </Fragment>
            ))}

            {/* One divider + block per guest list, in list-name order — reusing the same
                divider styling the "To fill in" fence uses, so this needs no new CSS. */}
            {guestListGroups.map((group) => (
              <Fragment key={group.id}>
                <tr className="roster-divider">
                  <td className="col-tick" aria-hidden />
                  <td colSpan={4}>
                    Guest list — {group.name || "Unnamed list"}
                    {group.contactName && ` (contact: ${group.contactName})`}
                  </td>
                </tr>
                {group.rows.map((row, i) => (
                  <RosterTableRow key={`${group.id}-${i}`} row={row} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="font-body text-sm text-marine/60">
            No tickets sold for this event yet.
          </p>
        )}
      </div>
    </>
  );
}
