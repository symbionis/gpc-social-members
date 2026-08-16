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
    guestListId: null,
    guestListName: "",
    guestListContact: "",
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

  it("carries no cancellation marking — cancelled seats never reach the sheet", () => {
    // buildDoorRoster filters them out, so the door and the admin roster show the same people.
    // A struck-through line the door cannot admit was noise on a document read under pressure.
    renderSheet([row({ last: "Ace", first: "Ann", named: true })]);
    expect(screen.queryByText(/CANCELLED/)).toBeNull();
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

describe("DoorRosterSheet — guest lists (U6)", () => {
  // Regression guard: an event with no guest lists must render exactly as it did before
  // this change — no stray guest-list section, no divider that only guest lists would add.
  it("renders exactly as before when no row carries a guest list", () => {
    renderSheet([
      row({ last: "Adams", first: "Jane", named: true }),
      row({ last: "Smith", first: "Sam", named: true, isLead: true }),
    ]);
    expect(screen.queryByText(/Guest list —/)).toBeNull();
  });

  it("pulls guest-list guests out of the flat list and groups them under their list name, contact named", () => {
    const { container } = renderSheet([
      row({ last: "Zeta", first: "Zoe", named: true }), // an ordinary named ticket
      row({
        first: "Ana",
        last: "Vidal",
        named: true,
        guestListId: "gl-1",
        guestListName: "Cardis Sponsor",
        guestListContact: "Jane Doe",
      }),
      row({
        first: "Bruno",
        last: "Keller",
        named: true,
        guestListId: "gl-1",
        guestListName: "Cardis Sponsor",
        guestListContact: "Jane Doe",
      }),
    ]);

    // The guest-list guests are pulled out of the flat A–Z run (just Zeta here) and
    // printed afterward in their own section, sorted by surname within it (Keller before
    // Vidal).
    const surnames = [...container.querySelectorAll(".surname")].map((e) => e.textContent);
    expect(surnames).toEqual(["Zeta", "Keller", "Vidal"]);
    // ...but the section header names the list AND its contact.
    expect(screen.getByText(/Cardis Sponsor/)).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it("keeps the guest-list section out of the 'To fill in' fence — that divider is for the flat list only", () => {
    renderSheet([
      row({ last: "Adams", first: "Jane", named: true }),
      row({ named: false }), // an unnamed ordinary ticket, still "to fill in"
      row({
        first: "Ana",
        last: "Vidal",
        named: true,
        guestListId: "gl-1",
        guestListName: "Cardis Sponsor",
        guestListContact: "Jane Doe",
      }),
    ]);
    expect(screen.getAllByText("To fill in")).toHaveLength(1);
  });

  it("orders multiple guest lists by name and each list's guests by surname", () => {
    const { container } = renderSheet([
      row({
        first: "Bruno",
        last: "Keller",
        named: true,
        guestListId: "gl-zeta",
        guestListName: "Zeta Partners",
        guestListContact: "Zed",
      }),
      row({
        first: "Ana",
        last: "Vidal",
        named: true,
        guestListId: "gl-cardis",
        guestListName: "Cardis Sponsor",
        guestListContact: "Jane Doe",
      }),
      row({
        first: "Chloe",
        last: "Adams",
        named: true,
        guestListId: "gl-cardis",
        guestListName: "Cardis Sponsor",
        guestListContact: "Jane Doe",
      }),
    ]);
    const text = container.querySelector(".roster-table")!.textContent ?? "";
    // Cardis Sponsor sorts before Zeta Partners; within Cardis, Adams sorts before Vidal.
    expect(text.indexOf("Cardis Sponsor")).toBeLessThan(text.indexOf("Zeta Partners"));
    expect(text.indexOf("Adams")).toBeLessThan(text.indexOf("Vidal"));
    expect(text.indexOf("Vidal")).toBeLessThan(text.indexOf("Keller"));
  });
});
