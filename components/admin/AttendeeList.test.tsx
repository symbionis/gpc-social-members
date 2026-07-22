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
    isComp: false,
    named: true,
    cancelled: false,
    ...overrides,
  };
}

function renderList(attendees: Attendee[]) {
  return render(<AttendeeList attendees={attendees} baseUrl="https://app.test" eventId="evt-1" />);
}

const groups = () => screen.queryAllByTestId("address-group");
const rows = () => screen.queryAllByTestId("ticket-row");

beforeEach(() => {
  seq = 0;
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

describe("U15 — roster grouped by email address (R26)", () => {
  it("renders two tickets sharing an address as one group", () => {
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch" }),
      ticket({ name: "Ben Adult", email: "HOUSE@x.ch" }), // same address, different case
    ]);
    expect(groups()).toHaveLength(1);
    // Both people are listed under the single group.
    const group = groups()[0];
    expect(within(group).getByText("Ana Adult")).toBeInTheDocument();
    expect(within(group).getByText("Ben Adult")).toBeInTheDocument();
  });

  it("renders two distinct addresses as two groups", () => {
    renderList([
      ticket({ name: "Ana Adult", email: "ana@x.ch" }),
      ticket({ name: "Cy Solo", email: "cy@x.ch" }),
    ]);
    expect(groups()).toHaveLength(2);
    expect(screen.getByLabelText("ana@x.ch")).toBeInTheDocument();
    expect(screen.getByLabelText("cy@x.ch")).toBeInTheDocument();
  });
});

describe("U15 — every ticket sold is shown (R25)", () => {
  it("renders one row per sold ticket, named or not", () => {
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch" }),
      ticket({ name: "Ben Adult", email: "house@x.ch" }),
      // A still-`issued` (unnamed) ticket — must still occupy a row so the roster length
      // matches tickets sold.
      ticket({ name: "", email: "", named: false, manageToken: null, ticketTypeTitle: "Kids" }),
    ]);
    expect(rows()).toHaveLength(3);
  });

  it("keeps a named guest with no email OUT of the unnamed bucket (comp-list case)", () => {
    // A claimed comp-guest ticket carries a real name but no email address
    // (tickets_contact_present allows an is_comp row with NULL email). It must read as named,
    // not as an "issued/unnamed" slot.
    renderList([
      ticket({
        name: "Deb Comp",
        email: "",
        named: true,
        manageToken: null,
        referenceCode: "GPC-7",
        ticketTypeTitle: "Guest",
      }),
    ]);
    const group = screen.getByLabelText("Booking GPC-7");
    expect(within(group).getByText("Deb Comp")).toBeInTheDocument();
    // Not "Not named" — the guest is named, just address-less.
    expect(within(group).queryByText("Not named")).toBeNull();
    expect(within(group).getByText("No email")).toBeInTheDocument();
    // No address → no Resend.
    expect(within(group).queryByRole("button", { name: /Resend tickets to/ })).toBeNull();
  });

  it("groups an unnamed ticket under its booking, marked not-named, with no resend", () => {
    renderList([
      ticket({ name: "", email: "", named: false, manageToken: null, referenceCode: "GPC-9" }),
    ]);
    const group = screen.getByLabelText("Unnamed · booking GPC-9");
    expect(group).toBeInTheDocument();
    expect(within(group).getByText("Not named")).toBeInTheDocument();
    // An address is required to resend, so an unnamed group offers no Resend button.
    expect(within(group).queryByRole("button", { name: /Resend tickets to/ })).toBeNull();
  });
});

describe("U15 — cancelled tickets render distinctly", () => {
  it("marks a cancelled ticket and offers it no Remove button", () => {
    renderList([
      ticket({ id: "t-live", name: "Ana Adult", email: "house@x.ch" }),
      ticket({ id: "t-cancelled", name: "Ben Adult", email: "house@x.ch", cancelled: true }),
    ]);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    // The cancelled name is struck through.
    expect(screen.getByText("Ben Adult")).toHaveClass("line-through");
    // A cancelled ticket gets no Remove affordance; the live guest still does.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });
});

describe("U15 — resend targets an email address", () => {
  it("posts the address to the per-address resend endpoint", async () => {
    const user = userEvent.setup();
    renderList([
      ticket({ name: "Ana Adult", email: "house@x.ch", notified: false }),
      ticket({ name: "Ben Adult", email: "house@x.ch", notified: false }),
    ]);
    await user.click(screen.getByRole("button", { name: "Resend tickets to house@x.ch" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/evt-1/resend-household");
    expect(JSON.parse(init.body)).toEqual({ email: "house@x.ch" });
  });

  it("shows a group as Notified only when every live ticket has been emailed", () => {
    renderList([
      ticket({ email: "mixed@x.ch", notified: true }),
      ticket({ email: "mixed@x.ch", notified: false }),
    ]);
    expect(screen.getByText("Not notified")).toBeInTheDocument();
    expect(screen.queryByText("Notified")).toBeNull();
  });
});
