// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

import DoorRosterSheet from "@/components/events/DoorRosterSheet";
import type { RosterEvent, RosterRow } from "@/lib/events/door-roster";

const event: RosterEvent = { id: "e1", title: "Summer Polo", start_date: "2026-06-06" };

function row(over: Partial<RosterRow>): RosterRow {
  return {
    bookingRef: "REF1",
    last: "",
    first: "",
    ticketType: "Standard",
    email: "",
    phone: "",
    isMember: "",
    partyLead: "",
    tickets: "",
    waiver: "",
    arrived: "",
    isLead: false,
    named: false,
    cancelled: false,
    ...over,
  };
}

function renderSheet(rows: RosterRow[]) {
  return render(<DoorRosterSheet event={event} rows={rows} typeTotals={[]} />);
}

describe("DoorRosterSheet (flat A–Z)", () => {
  it("renders rows in the given flat order with per-row ref and contact", () => {
    const { container } = renderSheet([
      row({ last: "Adams", first: "Jane", bookingRef: "EV-S", phone: "+41111", partyLead: "guest of Sam Smith", named: true }),
      row({ last: "Smith", first: "Sam", bookingRef: "EV-S", phone: "+41999", partyLead: "lead", isLead: true, tickets: "2", named: true }),
    ]);
    // The list is flat: surnames appear in exactly the order the rows were given.
    const surnames = [...container.querySelectorAll(".surname")].map((e) => e.textContent);
    expect(surnames).toEqual(["Adams", "Smith"]);
    // Contact + ref render on the guest row too, not just the lead.
    expect(screen.getByText("+41111")).toBeInTheDocument();
    expect(screen.getAllByText("EV-S").length).toBe(2);
  });

  it("shows the 'To fill in' divider once, after the named rows and before the blanks", () => {
    const { container } = renderSheet([
      row({ last: "Adams", first: "Jane", named: true }),
      row({ named: false }),
      row({ named: false }),
    ]);
    expect(screen.getAllByText("To fill in")).toHaveLength(1);
    // The divider sits between the named row and the first blank.
    const text = container.querySelector(".roster-table")!.textContent ?? "";
    expect(text.indexOf("Adams")).toBeLessThan(text.indexOf("To fill in"));
  });

  it("omits the divider when every row is named", () => {
    renderSheet([
      row({ last: "Adams", first: "Jane", named: true }),
      row({ last: "Smith", first: "Sam", named: true }),
    ]);
    expect(screen.queryByText("To fill in")).toBeNull();
  });

  it("omits the divider when every row is unnamed (all-blank sheet)", () => {
    renderSheet([row({ named: false }), row({ named: false })]);
    expect(screen.queryByText("To fill in")).toBeNull();
  });

  it("renders the party label on both lead and guest rows", () => {
    renderSheet([
      row({ last: "Smith", first: "Sam", partyLead: "lead", isLead: true, named: true }),
      row({ last: "Adams", first: "Jane", partyLead: "guest of Sam Smith", named: true }),
    ]);
    expect(screen.getByText("lead")).toBeInTheDocument();
    expect(screen.getByText("guest of Sam Smith")).toBeInTheDocument();
  });

  it("marks a cancelled ticket", () => {
    renderSheet([row({ last: "Ace", first: "Ann", named: true, cancelled: true })]);
    expect(screen.getByText(/CANCELLED/)).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no tickets", () => {
    renderSheet([]);
    expect(screen.getByText(/No tickets sold/i)).toBeInTheDocument();
  });

  it("counts tickets and named from the flat rows", () => {
    const { container } = renderSheet([
      row({ last: "Adams", first: "Jane", named: true }),
      row({ named: false }),
      row({ named: false }),
    ]);
    const counts = container.querySelector(".roster-counts")!.textContent ?? "";
    expect(counts).toMatch(/3 tickets/);
    expect(counts).toMatch(/1 named/);
    expect(counts).toMatch(/2 to fill in/);
  });
});
