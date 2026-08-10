// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

import EventMonthlyPanel from "@/components/admin/finance/EventMonthlyPanel";
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
      monthKey: "2026-04",
      gross: 800,
      refunds: 0,
      net: 800,
      paidRegistrations: 2,
      byEvent: [{ eventId: "e2", title: "Autumn Ball", gross: 800, refunds: 0, net: 800, paidRegistrations: 2 }],
    },
    {
      monthKey: "2026-06",
      gross: 2000,
      refunds: 0,
      net: 2000,
      paidRegistrations: 3,
      byEvent: [{ eventId: "e1", title: "Summer Gala", gross: 2000, refunds: 0, net: 2000, paidRegistrations: 3 }],
    },
  ],
};

const monthRow = (label: string | RegExp) => screen.getByRole("button", { name: label });

describe("EventMonthlyPanel", () => {
  it("lists months oldest first with their paid count and gross", () => {
    render(<EventMonthlyPanel events={EVENTS} />);
    const months = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(months.map((b) => b.textContent)).toHaveLength(2);
    expect(months[0]).toHaveTextContent("April 2026");
    expect(months[0]).toHaveTextContent("2 paid");
    expect(months[0]).toHaveTextContent("CHF 800");
    expect(months[1]).toHaveTextContent("June 2026");
  });

  it("shows each month's events on arrival, under an Event/Paid/Refunded/Net header", () => {
    render(<EventMonthlyPanel events={EVENTS} />);
    expect(screen.getByText("Summer Gala")).toBeInTheDocument();
    expect(screen.getByText("Autumn Ball")).toBeInTheDocument();
    const headers = within(screen.getAllByRole("table")[0])
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Event", "Paid", "Refunded", "Net"]);
  });

  it("collapses a month's events and restores them", async () => {
    const user = userEvent.setup();
    render(<EventMonthlyPanel events={EVENTS} />);
    const june = monthRow(/June 2026/);

    await user.click(june);
    expect(june).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Summer Gala")).not.toBeInTheDocument();
    // Only June collapsed — April's event is untouched.
    expect(screen.getByText("Autumn Ball")).toBeInTheDocument();

    await user.click(june);
    expect(screen.getByText("Summer Gala")).toBeInTheDocument();
  });

  it("collapses and expands every month from the header control", async () => {
    const user = userEvent.setup();
    render(<EventMonthlyPanel events={EVENTS} />);

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Summer Gala")).not.toBeInTheDocument();
    expect(screen.queryByText("Autumn Ball")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Summer Gala")).toBeInTheDocument();
  });

  it("shows each month's events summing to that month's gross", () => {
    render(<EventMonthlyPanel events={EVENTS} />);
    for (const month of EVENTS.byMonth) {
      expect(month.byEvent.reduce((t, e) => t + e.gross, 0)).toBe(month.gross);
    }
    // And the rendered month rows sum to the headline gross.
    expect(EVENTS.byMonth.reduce((t, m) => t + m.gross, 0)).toBe(EVENTS.gross);
  });

  it("says only completed checkouts count, so the figure is not read as bookings", () => {
    render(<EventMonthlyPanel events={EVENTS} />);
    expect(screen.getByText(/abandoned checkout never reaches this table/)).toBeInTheDocument();
  });

  it("states the empty case rather than rendering a bare table", () => {
    render(<EventMonthlyPanel events={{ ...EVENTS, byMonth: [] }} />);
    expect(screen.getByText("No event sales in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Nothing to collapse, so no control.
    expect(screen.queryByRole("button", { name: /Collapse all|Expand all/ })).not.toBeInTheDocument();
  });

  it("labels months through formatMonth rather than a raw key", () => {
    render(<EventMonthlyPanel events={EVENTS} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-06")).not.toBeInTheDocument();
  });
});
