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
      paidTickets={18}
      freeTickets={0}
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
    expect(screen.getByText("Guest list tickets")).toBeInTheDocument();
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
    expect(screen.queryByText("Guest list tickets")).toBeNull();
  });

  // A list can exist whose comps were all removed. The count is what decides visibility, so
  // the panel still appears and honestly reads 0 rather than vanishing mid-event.
  it("still shows a list whose comps have all been removed", () => {
    renderSummary({ guestListSeats: 0, guestListCount: 1 });
    expect(screen.getByText("Guest list tickets")).toBeInTheDocument();
    expect(screen.getByText("across 1 guest list")).toBeInTheDocument();
  });

  it("keeps leading with active tickets and the cap", () => {
    renderSummary();
    expect(screen.getByText("Active tickets")).toBeInTheDocument();
    expect(screen.getByText("of 17 cap")).toBeInTheDocument();
  });
});

describe("EventRosterSummary — the ticket split", () => {
  // The reason the split exists. "Sold" used to mean "booked" and swept comps in with it, so
  // an event with a guest list reported tickets as sold that were never paid for.
  it("counts paid tickets separately from comped ones", () => {
    renderSummary({ total: 8, booked: 10, paidTickets: 7, freeTickets: 0, cancelledSeats: 2, guestListSeats: 3, guestListCount: 1 });

    expect(screen.getByText("Paid tickets")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Guest list tickets")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // Nothing on screen claims 10 tickets were sold.
    expect(screen.queryByText("Sold")).toBeNull();
    expect(screen.queryByText("Sold tickets")).toBeNull();
  });

  // paid + free + guest list = booked, and booked − cancelled = active.
  it("shows figures that reconcile both ways", () => {
    renderSummary({ total: 8, booked: 10, paidTickets: 7, freeTickets: 0, cancelledSeats: 2, guestListSeats: 3, guestListCount: 1 });

    expect(screen.getByText("Active tickets")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Booked tickets")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Cancelled tickets")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("names free tickets on a free event", () => {
    renderSummary({ total: 40, booked: 40, paidTickets: 0, freeTickets: 37, cancelledSeats: 0, guestListSeats: 3, guestListCount: 1 });

    expect(screen.getByText("Free tickets")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.queryByText("Paid tickets")).toBeNull();
  });

  // On a plain paid event active/booked/paid are one number said three times.
  it("hides the split when it would only restate the active count", () => {
    renderSummary({ total: 10, booked: 10, paidTickets: 10, freeTickets: 0, cancelledSeats: 0, guestListSeats: 0, guestListCount: 0 });

    expect(screen.queryByText("Booked tickets")).toBeNull();
    expect(screen.queryByText("Paid tickets")).toBeNull();
    expect(screen.queryByText("Cancelled tickets")).toBeNull();
    expect(screen.getByText("Active tickets")).toBeInTheDocument();
  });
});
