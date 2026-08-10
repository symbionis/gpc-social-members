// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in the vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// The other tabs are irrelevant to the Waitlist tab under test (and AttendeeList
// draws a canvas QR, which jsdom cannot). Stub them so assertions stay about the
// waitlist table.
vi.mock("@/components/admin/AttendeeList", () => ({ default: () => <div>attendee list</div> }));
vi.mock("@/components/admin/GuestList", () => ({ default: () => <div>guest list</div> }));
vi.mock("@/components/admin/EventCheckInPanel", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventCheckInSettings", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventInviteLink", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventRosterSummary", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventMessaging", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/CancellationsPanel", () => ({ default: () => <div /> }));

import ManageEventTabs from "@/components/admin/ManageEventTabs";

type Props = React.ComponentProps<typeof ManageEventTabs>;
type WaitlistEntry = Props["waitlist"][number];

const TICKET_TYPES: Props["ticketTypes"] = [
  {
    id: "tt-asado",
    title: "Asado",
    price_member: 90,
    price_non_member: 120,
    invite_price: null,
    counts_as_seat: true,
  },
  {
    id: "tt-child",
    title: "Child",
    price_member: 0,
    price_non_member: 0,
    invite_price: null,
    counts_as_seat: false,
  },
];

function waitlistEntry(over: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: "wl-1",
    name: "Astrid Ferrari",
    email: "astrid@x.ch",
    created_at: "2026-08-01T10:00:00Z",
    ticket_type_id: "tt-asado",
    ticket_type_title: "Asado",
    quantity: 2,
    offered: false,
    offer_sent_count: 0,
    offerable: true,
    offerable_reason: null,
    redeemed: false,
    ...over,
  };
}

function renderTabs(over: Partial<Props> = {}) {
  const props: Props = {
    eventId: "ev-1",
    attendees: [],
    stripeTestMode: false,
    checkedInCount: 0,
    ticketTypeSummary: [],
    waitlist: [],
    hasSeatCap: true,
    total: 0,
    sold: 0,
    cancelledSeats: 0,
    seatCap: 10,
    overbooked: false,
    baseUrl: "https://example.test",
    reminders: [],
    sentMessages: [],
    reminderSchedule: [],
    visibility: "members_only",
    inviteCode: null,
    ticketTypes: TICKET_TYPES,
    registrationEnabled: true,
    guestLists: [],
    cancellations: [],
    ...over,
  };
  return render(<ManageEventTabs {...props} />);
}

function okFetch(payload: Record<string, unknown> = { success: true }) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}
function failFetch(payload: Record<string, unknown>, status = 400) {
  return vi.fn().mockResolvedValue({ ok: false, status, json: async () => payload });
}

async function openWaitlistTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Waitlist/ }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
  global.fetch = okFetch();
});

describe("ManageEventTabs — Waitlist tab: Offer / Resend", () => {
  it("offers an offerable entry and shows the offered state after success", async () => {
    global.fetch = okFetch({ success: true, email_sent: true, offer_sent_count: 1 });
    const user = userEvent.setup();
    renderTabs({ waitlist: [waitlistEntry()] });
    await openWaitlistTab(user);

    const row = screen.getByText("Astrid Ferrari").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Offer" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/events/ev-1/waitlist/wl-1/offer",
      expect.objectContaining({ method: "POST" })
    );
    expect(await screen.findByText(/Offer sent to Astrid Ferrari/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("a disabled Offer control on a flagged row is described by its reason", async () => {
    const user = userEvent.setup();
    renderTabs({
      waitlist: [
        waitlistEntry({
          ticket_type_id: null,
          ticket_type_title: null,
          offerable: false,
          offerable_reason: "No ticket type is set for this entry",
        }),
      ],
    });
    await openWaitlistTab(user);

    const offerBtn = screen.getByRole("button", { name: "Offer" });
    expect(offerBtn).toHaveAttribute("aria-disabled", "true");
    const describedBy = offerBtn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "No ticket type is set for this entry"
    );

    // aria-disabled keeps the control focusable rather than removed from the tab order.
    expect(offerBtn).not.toBeDisabled();

    // Clicking a flagged row's Offer control must not fire the request.
    await user.click(offerBtn);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("repairing a flagged row re-renders it as offerable with Offer enabled, without a page reload", async () => {
    global.fetch = okFetch({
      success: true,
      entry: { id: "wl-1", ticket_type_id: "tt-asado", quantity: 3 },
    });
    const user = userEvent.setup();
    renderTabs({
      waitlist: [
        waitlistEntry({
          ticket_type_id: null,
          ticket_type_title: null,
          offerable: false,
          offerable_reason: "No ticket type is set for this entry",
        }),
      ],
    });
    await openWaitlistTab(user);

    await user.click(screen.getByRole("button", { name: "Fix" }));
    await user.selectOptions(screen.getByLabelText("Ticket type"), "tt-asado");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/events/ev-1/waitlist/wl-1",
      expect.objectContaining({ method: "PATCH" })
    );

    const offerBtn = await screen.findByRole("button", { name: "Offer" });
    expect(offerBtn).toHaveAttribute("aria-disabled", "false");
    expect(screen.queryByText("No ticket type is set for this entry")).not.toBeInTheDocument();

    // The only DOM navigation signal available is router.refresh(); confirm it was
    // called (soft refresh) without asserting on a hard reload, which jsdom can't do.
    expect(refresh).toHaveBeenCalled();
  });

  it("a failed repair leaves the row flagged and shows the error inline", async () => {
    global.fetch = failFetch({ error: "Ticket type not found for this event" });
    const user = userEvent.setup();
    renderTabs({
      waitlist: [
        waitlistEntry({
          ticket_type_id: null,
          ticket_type_title: null,
          offerable: false,
          offerable_reason: "No ticket type is set for this entry",
        }),
      ],
    });
    await openWaitlistTab(user);

    await user.click(screen.getByRole("button", { name: "Fix" }));
    await user.selectOptions(screen.getByLabelText("Ticket type"), "tt-asado");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Ticket type not found for this event")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offer" })).toHaveAttribute("aria-disabled", "true");
  });

  it("withdraws an offered entry, clearing its offered state (AE10)", async () => {
    global.fetch = okFetch({ success: true });
    const user = userEvent.setup();
    renderTabs({ waitlist: [waitlistEntry({ offered: true, offer_sent_count: 2 })] });
    await openWaitlistTab(user);

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/events/ev-1/waitlist/wl-1/offer",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(await screen.findByRole("button", { name: "Offer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("does not render a quantity input or an over-cap confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    renderTabs({
      total: 9,
      seatCap: 10,
      waitlist: [waitlistEntry({ quantity: 5 })],
    });
    await openWaitlistTab(user);

    expect(screen.queryByLabelText("Tickets")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Register free" }));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("redeemed entries are hidden from the waitlist tab", async () => {
    const user = userEvent.setup();
    renderTabs({
      waitlist: [waitlistEntry({ id: "wl-redeemed", name: "Already In", redeemed: true })],
    });
    await openWaitlistTab(user);
    expect(screen.queryByText("Already In")).not.toBeInTheDocument();
  });
});
