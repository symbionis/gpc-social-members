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

describe("EventRosterSummary — guest-list attendance pair (R14)", () => {
  // "Guests on lists" and "guests admitted" are reported as their own pair, sitting alongside
  // one another rather than folded into anything ticketed.
  it("shows guests-on-lists and guests-admitted as separate panels", () => {
    renderSummary({ guestListSeats: 5, guestListCount: 1, guestListAdmitted: 2 });

    expect(screen.getByText("Guest list tickets")).toBeInTheDocument();
    expect(screen.getByText("Guest list admitted")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("of 5 on lists")).toBeInTheDocument();
  });

  it("pluralises 'on list' for a single guest-list seat", () => {
    renderSummary({ guestListSeats: 1, guestListCount: 1, guestListAdmitted: 1 });
    expect(screen.getByText("of 1 on list")).toBeInTheDocument();
  });

  // Defaults to 0 admitted rather than omitting the panel — an event whose guest list has not
  // started checking in yet should read "0 admitted", not silently drop the figure.
  it("defaults guest-list admitted to 0 when not supplied", () => {
    renderSummary({ guestListSeats: 5, guestListCount: 1 });
    expect(screen.getByText("Guest list admitted")).toBeInTheDocument();
    expect(screen.getByText("of 5 on lists")).toBeInTheDocument();
  });

  it("hides the admitted panel along with the rest when there is no guest list", () => {
    renderSummary({ guestListSeats: 0, guestListCount: 0 });
    expect(screen.queryByText("Guest list admitted")).toBeNull();
  });
});

describe("EventRosterSummary — ticketed check-in rate (R19/KTD11)", () => {
  it("is absent until a caller supplies checkedInTickets", () => {
    renderSummary();
    expect(screen.queryByText("Checked in")).toBeNull();
  });

  it("computes checked-in ÷ registered, purely ticketed", () => {
    renderSummary({ total: 20, checkedInTickets: 10 });
    expect(screen.getByText("Checked in")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("10 of 20 ticketed")).toBeInTheDocument();
  });

  // The reason KTD11 exists: with a guest list present, `total` (seats_used) and
  // `checkedInTickets` must BOTH already exclude guest-list tickets — passed here as the
  // caller is contracted to supply them — so the rate never reads past 100% even though the
  // event also has guest-list guests checking in through a separate pair.
  it("never exceeds 100% with guest-list guests present", () => {
    renderSummary({
      total: 10,
      checkedInTickets: 10,
      guestListSeats: 6,
      guestListCount: 1,
      guestListAdmitted: 6,
    });
    // Exactly 100%, not more — a naive rate that folded guest-list admissions into a ticketed
    // denominator of 10 would read 16/10 = 160%.
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("rounds to the nearest percent", () => {
    renderSummary({ total: 3, checkedInTickets: 1 });
    expect(screen.getByText("33%")).toBeInTheDocument();
  });
});

describe("EventRosterSummary — ticket-type totals include guest lists (R14)", () => {
  it("unions purchased and guest-list guests, labelled", () => {
    renderSummary({
      ticketTypeSummary: [
        {
          id: "tt-1",
          title: "Dinner",
          priceMember: 50,
          priceNonMember: 60,
          countsAsSeat: true,
          sold: 9,
          guestListSold: 2,
        },
      ],
    });

    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("incl. 2 guest list")).toBeInTheDocument();
  });

  // Regression guard: a type with no guest-list guests renders exactly as it did before —
  // sold alone, no badge.
  it("shows sold alone with no badge when a type has no guest-list guests", () => {
    renderSummary({
      ticketTypeSummary: [
        {
          id: "tt-1",
          title: "Dinner",
          priceMember: 50,
          priceNonMember: 60,
          countsAsSeat: true,
          sold: 9,
        },
      ],
    });

    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText(/incl\./)).toBeNull();
  });
});

describe("EventRosterSummary — regression guard (no guest lists)", () => {
  // U9 test scenario 6: an event with no guest lists, and no check-in figure supplied, must
  // render exactly as it did before this unit — none of the new panels appear unasked.
  it("shows none of the new panels when there is no guest list and no check-in figure", () => {
    renderSummary({
      total: 10,
      booked: 10,
      paidTickets: 10,
      freeTickets: 0,
      cancelledSeats: 0,
      guestListSeats: 0,
      guestListCount: 0,
    });

    expect(screen.queryByText("Checked in")).toBeNull();
    expect(screen.queryByText("Guest list tickets")).toBeNull();
    expect(screen.queryByText("Guest list admitted")).toBeNull();
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
