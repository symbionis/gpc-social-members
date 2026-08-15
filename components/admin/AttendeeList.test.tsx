// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

// The component calls router.refresh() after a successful mutation.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AttendeeList, { type Attendee } from "@/components/admin/AttendeeList";

let seq = 0;
function ticket(overrides: Partial<Attendee> = {}): Attendee {
  seq += 1;
  return {
    id: `t-${seq}`,
    registrationId: "r1",
    referenceCode: "GPC-1",
    name: "Ana Adult",
    email: "house@x.ch",
    phone_e164: "",
    isMember: false,
    isLead: false,
    ticketTypeTitle: "Asado",
    manageToken: "mt-1",
    notified: true,
    waiverSigned: true,
    checkedIn: false,
    arrivedAt: null,
    createdAt: `2026-01-01T00:00:0${seq}Z`,
    named: true,
    priceChf: 45,
    ...overrides,
  };
}

function renderList(attendees: Attendee[]) {
  return render(
    <AttendeeList attendees={attendees} baseUrl="https://app.test" eventId="evt-1" />
  );
}

const rows = () => screen.queryAllByTestId("ticket-row");
const rowNames = () =>
  rows().map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");

beforeEach(() => {
  seq = 0;
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

// The roster is a flat A–Z list of PEOPLE, ordered by the same comparator the printed door
// sheet and the door console use. Staff move between the three mid-shift with someone waiting,
// so a name has to sit in the same place on all of them.
describe("roster is one flat, surname-ordered row per ticket", () => {
  it("gives every ticket its own row, including housemates", () => {
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch" }),
      ticket({ name: "Ben Adult", email: "HOUSE@x.ch" }), // same address, different case
    ]);
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("Ana Adult")).toBeInTheDocument();
    expect(screen.getByText("Ben Adult")).toBeInTheDocument();
  });

  it("orders by surname, not by booking or address", () => {
    renderList([
      ticket({ name: "Zoe Zider", email: "z@x.ch" }),
      ticket({ name: "Ana Adult", email: "a@x.ch" }),
      ticket({ name: "Mia Mueller", email: "m@x.ch" }),
    ]);
    const names = rowNames();
    expect(names[0]).toContain("Ana Adult");
    expect(names[1]).toContain("Mia Mueller");
    expect(names[2]).toContain("Zoe Zider");
  });

  it("keeps unnamed slots at the end rather than sorting them under a blank name", () => {
    renderList([
      ticket({ name: "", email: "", named: false, manageToken: null }),
      ticket({ name: "Ana Adult", email: "a@x.ch" }),
    ]);
    const names = rowNames();
    expect(names[0]).toContain("Ana Adult");
    expect(names[1]).toContain("Unnamed");
  });

  it("renders one row per sold ticket, named or not", () => {
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch" }),
      ticket({ name: "Ben Adult", email: "house@x.ch" }),
      ticket({ name: "", email: "", named: false, manageToken: null, ticketTypeTitle: "Kids" }),
    ]);
    expect(rows()).toHaveLength(3);
  });

  it("shows a named guest with no email as themselves, not as an unnamed slot", () => {
    // A claimed comp-guest ticket carries a real name but no address (tickets_contact_present's
    // retained comp disjunct — KTD6 — allows such a row with NULL email).
    renderList([
      ticket({ name: "Deb Comp", email: "", named: true, manageToken: null, referenceCode: "GPC-7" }),
    ]);
    expect(screen.getByText("Deb Comp")).toBeInTheDocument();
    expect(screen.queryByText(/^Unnamed$/)).toBeNull();
    // No address → nothing to resend to.
    expect(screen.queryByRole("button", { name: /Resend tickets to/ })).toBeNull();
  });
});

// The household survives as a cross-reference, not a container: everyone keeps their own row,
// and the arrow answers "who are they here with?".
describe("household expander", () => {
  const household = () => [
    ticket({ name: "Ana Adult", email: "house@x.ch" }),
    ticket({ name: "Ben Baker", email: "house@x.ch" }),
  ];

  it("offers an expander only where an address carries more than one ticket", () => {
    renderList([...household(), ticket({ name: "Cy Solo", email: "cy@x.ch" })]);
    // Two housemates each get one; the solo holder gets none.
    expect(screen.getAllByTestId("household-toggle")).toHaveLength(2);
  });

  it("offers no expander for a ticket with no email", () => {
    renderList([ticket({ name: "Deb Comp", email: "", manageToken: null })]);
    expect(screen.queryByTestId("household-toggle")).toBeNull();
  });

  it("reveals the other people on the address, collapsed by default", async () => {
    const user = userEvent.setup();
    renderList(household());
    expect(screen.queryByTestId("household-detail")).toBeNull();

    // Expand Ana's row → Ben is named as her housemate.
    await user.click(screen.getAllByTestId("household-toggle")[0]);
    const detail = screen.getByTestId("household-detail");
    expect(within(detail).getByText("Ben Baker")).toBeInTheDocument();
    expect(within(detail).queryByText("Ana Adult")).toBeNull();
  });

  it("does not hide a housemate — they keep their own top-level row", () => {
    renderList(household());
    // Collapsed: both are still first-class rows, so either is findable by scanning.
    expect(rows()).toHaveLength(2);
    expect(rowNames()[0]).toContain("Ana Adult");
    expect(rowNames()[1]).toContain("Ben Baker");
  });
});

describe("the roster shows live seats only", () => {
  it("is a read-only roster — no seat can be freed from here", () => {
    // Cancelled seats are filtered out upstream (the page), so this component never sees one.
    // Freeing a seat is a cancellation now, handled in the Refunds tab, so that every freed
    // seat carries an account of its money.
    renderList([
      ticket({ id: "t-lead", name: "Ana Adult", email: "house@x.ch", isLead: true }),
      ticket({ id: "t-guest", name: "Ben Baker", email: "house@x.ch" }),
    ]);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText("Ana Adult")).toBeInTheDocument();
    expect(screen.getByText("Ben Baker")).toBeInTheDocument();
  });

  // Now per-person rather than per-address: the roster is a list of people, so "has this one
  // been sent their QR" is answerable on their own row instead of being collapsed into a
  // whole-address verdict.
  it("flags only the person who has not been emailed", () => {
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch", notified: true }),
      ticket({ name: "Ben Baker", email: "house@x.ch", notified: false }),
    ]);
    expect(screen.getAllByText("Not notified")).toHaveLength(1);
    const benRow = rows().find((r) => within(r).queryByText("Ben Baker"));
    expect(within(benRow as HTMLElement).getByText("Not notified")).toBeInTheDocument();
  });

  it("does not flag an unnamed slot as un-notified — there is no QR to have sent", () => {
    renderList([ticket({ name: "", email: "", named: false, manageToken: null })]);
    expect(screen.queryByText("Not notified")).toBeNull();
  });
});

describe("resend targets an email address", () => {
  it("posts the row's address to the per-address resend endpoint", async () => {
    const user = userEvent.setup();
    renderList([ticket({ name: "Ana Adult", email: "house@x.ch", notified: false })]);
    await user.click(screen.getByRole("button", { name: "Resend tickets to house@x.ch" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/evt-1/resend-household");
    expect(JSON.parse(init.body)).toEqual({ email: "house@x.ch" });
  });

  // The grouped ticket email is still the delivery unit — one email per address carrying every
  // QR on it — so resending from either housemate's row is the same send.
  it("sends the same address from either housemate's row", async () => {
    const user = userEvent.setup();
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch" }),
      ticket({ name: "Ben Baker", email: "house@x.ch" }),
    ]);
    const buttons = screen.getAllByRole("button", { name: "Resend tickets to house@x.ch" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ email: "house@x.ch" });
  });
});

describe("no payment pill", () => {
  // The roster no longer marks payment state with a pill at all — what a seat cost is
  // answered by the price under its ticket type (or its absence), never by a badge.
  it("renders no Paid/Free/Comp/Special Guest pill regardless of price", () => {
    renderList([
      ticket({ name: "Ana Adult", priceChf: 45 }),
      ticket({ name: "Free Guest", priceChf: 0 }),
    ]);
    expect(screen.queryByText("Paid")).toBeNull();
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.queryByText("Comp")).toBeNull();
    expect(screen.queryByText("Special Guest")).toBeNull();
  });
});

describe("ticket price", () => {
  it("shows what the seat cost under its ticket type", () => {
    renderList([ticket({ name: "Ana Adult", ticketTypeTitle: "Terrace Seat", priceChf: 45 })]);
    expect(screen.getByText("Terrace Seat")).toBeInTheDocument();
    expect(screen.getByText("CHF 45.00")).toBeInTheDocument();
  });

  it("renders centimes rather than rounding them away", () => {
    renderList([ticket({ priceChf: 12.5 })]);
    expect(screen.getByText("CHF 12.50")).toBeInTheDocument();
  });

  // A historical comp ticket (now just another free-booking seat, R16/KD7) and a genuinely
  // free booking both value at zero. "CHF 0.00" reads as a price that was charged; the absent
  // line reads as no money, which is the truth.
  it("shows no price for a seat that cost nothing", () => {
    renderList([
      ticket({ name: "Comped Guest", email: "a@x.ch", priceChf: 0 }),
      ticket({ name: "Free Guest", email: "b@x.ch", priceChf: 0 }),
    ]);
    expect(screen.queryByText(/CHF/)).toBeNull();
  });
});
