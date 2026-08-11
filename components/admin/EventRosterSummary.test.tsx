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
      sold={23}
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

  // Same rule the sold/cancelled panels follow: a zero panel is noise on an event that has
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
