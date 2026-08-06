// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

import EventRevenuePanel from "@/components/admin/finance/EventRevenuePanel";
import type { EventSummary } from "@/lib/admin/finance";

const EVENTS: EventSummary = {
  gross: 2800,
  paidRegistrations: 5,
  freeRegistrations: 2,
  byEvent: [{ eventId: "e1", title: "Summer Gala", gross: 2800, paidRegistrations: 5 }],
  byTicketType: [{ title: "Standard", gross: 2800, quantity: 7 }],
  byMonth: [
    { monthKey: "2026-04", gross: 800, paidRegistrations: 2 },
    { monthKey: "2026-06", gross: 2000, paidRegistrations: 3 },
  ],
};

// The panel renders By month, By event, and By ticket type; target the one under
// a given heading rather than relying on document order.
function tableUnder(heading: string): HTMLElement {
  const h3 = screen.getByRole("heading", { name: heading });
  const table = h3.parentElement?.querySelector("table");
  if (!table) throw new Error(`no table under "${heading}"`);
  return table as HTMLElement;
}

describe("EventRevenuePanel", () => {
  it("lists ticket revenue per month, oldest first", () => {
    render(<EventRevenuePanel events={EVENTS} />);
    const rows = within(tableUnder("By month"))
      .getAllByRole("row")
      .slice(1) // drop the header row
      .map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      );
    expect(rows).toEqual([
      ["April 2026", "2", "CHF 800"],
      ["June 2026", "3", "CHF 2000"],
    ]);
  });

  it("labels months through formatMonth rather than a raw month key", () => {
    render(<EventRevenuePanel events={EVENTS} />);
    expect(within(tableUnder("By month")).getByText("June 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-06")).not.toBeInTheDocument();
  });

  it("renders every month, so the column sums to the headline gross", () => {
    render(<EventRevenuePanel events={EVENTS} />);
    // Read the rendered cells, not the fixture — a dropped month row is exactly
    // the regression this catches.
    const rendered = within(tableUnder("By month"))
      .getAllByRole("row")
      .slice(1)
      .map((r) => {
        const cells = within(r).getAllByRole("cell");
        return Number(cells[2].textContent!.replace("CHF ", ""));
      });
    expect(rendered.reduce((t, n) => t + n, 0)).toBe(EVENTS.gross);
  });

  it("states the empty case rather than rendering a bare month table", () => {
    render(
      <EventRevenuePanel
        events={{ ...EVENTS, gross: 0, paidRegistrations: 0, byEvent: [], byTicketType: [], byMonth: [] }}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByText("No event sales in this period.")).toHaveLength(3);
  });
});
