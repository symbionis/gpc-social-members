"use client";

import type { RosterEvent, RosterParty } from "@/lib/events/door-roster";

interface Props {
  event: RosterEvent;
  parties: RosterParty[];
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

/**
 * The printed door sheet: every ticket sold, one line each, parties A→Z by the lead's
 * surname with their guests indented beneath. Staff tick the box as each person
 * arrives, so a ticket with no line is a person who cannot be admitted — which is why
 * unnamed guests still get a line, with a rule to write the name on.
 *
 * The same rows, in the same order, back the CSV export (lib/events/door-roster).
 */
export default function DoorRosterSheet({ event, parties, typeTotals }: Props) {
  const totalTickets = parties.reduce((n, p) => n + p.rows.length, 0);
  const named = parties.reduce(
    (n, p) => n + p.rows.filter((r) => r.named).length,
    0
  );

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

          {/* One tbody per party: keeps a party from splitting across a page break. */}
          {parties.map((party, i) => (
            <tbody className="roster-party" key={`${party.rows[0]?.bookingRef}-${i}`}>
              {party.rows.map((row, j) => {
                const lead = row.isLead;
                return (
                  <tr
                    className={lead ? "roster-lead" : "roster-guest"}
                    key={`${i}-${j}`}
                    style={
                      row.cancelled
                        ? { textDecoration: "line-through", opacity: 0.55 }
                        : undefined
                    }
                  >
                    <td className="col-tick">
                      {row.cancelled ? (
                        <span aria-label="cancelled" style={{ textDecoration: "none" }}>✗</span>
                      ) : (
                        <span className="tickbox" aria-hidden />
                      )}
                    </td>
                    <td className="col-name">
                      {row.cancelled && (
                        <strong style={{ textDecoration: "none" }}>CANCELLED — </strong>
                      )}
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
                    </td>
                    <td className="col-type">{row.ticketType}</td>
                    <td className="col-contact">{lead ? row.phone : ""}</td>
                    <td className="col-ref">
                      {lead && (
                        <>
                          {row.bookingRef}
                          {row.tickets && (
                            <span className="qty"> ({row.tickets})</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>

        {parties.length === 0 && (
          <p className="font-body text-sm text-marine/60">
            No tickets sold for this event yet.
          </p>
        )}
      </div>
    </>
  );
}
