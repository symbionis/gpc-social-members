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
  refunds: 0,
  net: 2800,
  pendingRefunds: 0,
  paidRegistrations: 5,
  freeRegistrations: 2,
  byEvent: [
    { eventId: "e1", title: "Summer Gala", gross: 2000, refunds: 0, net: 2000, paidRegistrations: 3 },
    { eventId: "e2", title: "Autumn Ball", gross: 800, refunds: 0, net: 800, paidRegistrations: 2 },
  ],
  byTicketType: [{ title: "Standard", gross: 2800, refunds: 0, net: 2800, quantity: 7 }],
  byMonth: [
    {
      monthKey: "2026-06",
      gross: 2800,
      refunds: 0,
      net: 2800,
      paidRegistrations: 5,
      byEvent: [{ eventId: "e1", title: "Summer Gala", gross: 2800, refunds: 0, net: 2800, paidRegistrations: 5 }],
    },
  ],
};

describe("EventRevenuePanel", () => {
  it("shows the headline totals under their own labels", () => {
    render(<EventRevenuePanel events={EVENTS} />);
    // "Gross" is also a column header and "2" also appears in the By event
    // rows, so find the stat by its uppercase label element specifically.
    const statValue = (label: string) => {
      const labelEl = screen
        .getAllByText(label)
        .find((el) => el.className.includes("uppercase"))!;
      return labelEl.parentElement!.querySelector("div:nth-child(2)")!.textContent;
    };
    expect(statValue("Net")).toBe("CHF 2800");
    expect(statValue("Gross")).toBe("CHF 2800");
    expect(statValue("Paid registrations")).toBe("5");
    expect(statValue("Free / comp")).toBe("2");
  });

  it("lists each event, highest net first, summing to the headline", () => {
    render(<EventRevenuePanel events={EVENTS} />);
    const rows = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      );
    expect(rows).toEqual([
      ["Summer Gala", "3", "CHF 2000", "—", "CHF 2000"],
      ["Autumn Ball", "2", "CHF 800", "—", "CHF 800"],
    ]);
    const total = rows.reduce((t, r) => t + Number(r[4]!.replace("CHF ", "")), 0);
    expect(total).toBe(EVENTS.net);
  });

  it("does not render the month or ticket-type breakdowns — those are their own panels", () => {
    render(<EventRevenuePanel events={EVENTS} />);
    expect(screen.queryByText("June 2026")).not.toBeInTheDocument();
    expect(screen.queryByText("Standard")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("states the empty case rather than rendering a bare table", () => {
    render(<EventRevenuePanel events={{ ...EVENTS, gross: 0, byEvent: [] }} />);
    expect(screen.getByText("No event sales in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
