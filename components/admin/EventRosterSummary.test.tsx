// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import EventRosterSummary from "@/components/admin/EventRosterSummary";

afterEach(cleanup);

/**
 * The Overview's job is that its panels RECONCILE. An organiser reading "16 live seats" over a
 * list of 11 people needs the difference to be explainable on the same screen — that is what
 * these cases pin, not the styling.
 */
function renderSummary(overrides: Partial<React.ComponentProps<typeof EventRosterSummary>> = {}) {
  return render(
    <EventRosterSummary
      total={16}
      booked={23}
      cancelledSeats={7}
      guestListSeats={5}
      guestListCount={1}
      hasSeatCap
      seatCap={17}
      overbooked={false}
      ticketTypeSummary={[]}
      {...overrides}
    />
  );
}

describe("EventRosterSummary — guest list panel", () => {
  it("shows the comped seats and how many lists they came from", () => {
    renderSummary();
    expect(screen.getByText("Guest list seats")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("across 1 guest list")).toBeInTheDocument();
  });

  it("pluralises across several lists", () => {
    renderSummary({ guestListSeats: 9, guestListCount: 3 });
    expect(screen.getByText("across 3 guest lists")).toBeInTheDocument();
  });

  // Same rule the booked/cancelled panels follow: a zero panel is noise on an event that has
  // no guest lists at all.
  it("is absent when the event has no guest lists", () => {
    renderSummary({ guestListSeats: 0, guestListCount: 0 });
    expect(screen.queryByText("Guest list seats")).toBeNull();
  });

  // A list can exist whose comps were all removed. The count is what decides visibility, so
  // the panel still appears and honestly reads 0 rather than vanishing mid-event.
  it("still shows a list whose comps have all been removed", () => {
    renderSummary({ guestListSeats: 0, guestListCount: 1 });
    expect(screen.getByText("Guest list seats")).toBeInTheDocument();
    expect(screen.getByText("across 1 guest list")).toBeInTheDocument();
  });

  it("keeps leading with live seats and the cap", () => {
    renderSummary();
    expect(screen.getByText("Live seats")).toBeInTheDocument();
    expect(screen.getByText("of 17 cap")).toBeInTheDocument();
  });
});

describe("EventRosterSummary — the booked panel", () => {
  // This figure counts every seat booked, comp guest-list seats included (a guest list is a
  // `free` registration). Calling it "Sold" read as a revenue claim and misled an admin
  // looking at an event with a guest list: 3 of the seats had never been paid for.
  it("labels the figure Booked, never Sold", () => {
    renderSummary();
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.queryByText("Sold")).toBeNull();
  });

  // The whole point of showing the panel: booked − cancelled = live, on one screen.
  it("reconciles with live seats and cancellations", () => {
    renderSummary({ total: 8, booked: 10, cancelledSeats: 2 });
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  // On a clean event all three are the same number; two of them are noise.
  it("is hidden when nothing has been cancelled", () => {
    renderSummary({ total: 10, booked: 10, cancelledSeats: 0 });
    expect(screen.queryByText("Booked")).toBeNull();
    expect(screen.queryByText("Cancelled")).toBeNull();
  });
});
