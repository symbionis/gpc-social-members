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

// ManageEventTabs' other tabs are irrelevant here (and AttendeeList draws a canvas QR,
// which jsdom cannot). Stub them so the tab-bar assertions stay about the tab bar.
vi.mock("@/components/admin/AttendeeList", () => ({ default: () => <div>attendee list</div> }));
vi.mock("@/components/admin/EventCheckInPanel", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventCheckInSettings", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventInviteLink", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventRosterSummary", () => ({ default: () => <div /> }));
vi.mock("@/components/admin/EventMessaging", () => ({ default: () => <div /> }));

import GuestList, { type GuestListEntry } from "@/components/admin/GuestList";
import ManageEventTabs from "@/components/admin/ManageEventTabs";

type Props = React.ComponentProps<typeof GuestList>;

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

const entry = (over: Partial<GuestListEntry> = {}): GuestListEntry => ({
  registrationId: "reg-1",
  referenceCode: "GPC-777",
  leadName: "Ana Vidal",
  leadEmail: "ana@sponsor.ch",
  people: [
    {
      ticketId: "t-lead",
      name: "Ana Vidal",
      email: "ana@sponsor.ch",
      ticketTypeTitle: "Asado",
      isLead: true,
      checkedIn: false,
    },
    {
      ticketId: "t-guest",
      name: "Bruno Keller",
      email: null,
      ticketTypeTitle: "Asado",
      isLead: false,
      checkedIn: false,
    },
  ],
  ...over,
});

function renderGuestList(over: Partial<Props> = {}) {
  const props: Props = {
    eventId: "ev-1",
    ticketTypes: TICKET_TYPES,
    guestLists: [],
    hasSeatCap: false,
    seatCap: null,
    total: 0,
    ...over,
  };
  return render(<GuestList {...props} />);
}

/** The body of the nth fetch call, parsed. */
function bodyOf(call: number) {
  const mock = global.fetch as ReturnType<typeof vi.fn>;
  return JSON.parse(mock.mock.calls[call][1].body as string);
}

function okFetch(payload: Record<string, unknown> = { success: true, reference_code: "GPC-9" }) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
  global.fetch = okFetch();
});

describe("ManageEventTabs — Guest list replaces Import", () => {
  it("drops the Import tab and renders the guest list in its place", async () => {
    const user = userEvent.setup();
    render(
      <ManageEventTabs
        eventId="ev-1"
        attendees={[]}
        stripeTestMode={false}
        checkedInCount={0}
        guestsRegistered={0}
        ticketTypeSummary={[]}
        waitlist={[]}
        hasSeatCap={false}
        total={0}
        seatCap={null}
        overbooked={false}
        csvHref="/csv"
        baseUrl="https://example.test"
        reminders={[]}
        sentMessages={[]}
        reminderSchedule={[]}
        visibility="members_only"
        inviteCode={null}
        ticketTypes={TICKET_TYPES}
        registrationEnabled
        guestLists={[entry()]}
      />
    );

    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guest list" }));

    expect(screen.getByLabelText("Lead name")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Ana Vidal/ })).toBeInTheDocument();
  });
});

describe("GuestList — creating a comp list", () => {
  it("posts one create call carrying every person's ticket type", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");
    await user.selectOptions(screen.getByLabelText("Default ticket type"), "tt-asado");

    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Bruno Keller");
    await user.type(screen.getByLabelText("Guest 2 name"), "Chiara Bosco");
    await user.selectOptions(screen.getByLabelText("Guest 2 ticket type"), "tt-child");

    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/ev-1/guest-list");
    expect(init.method).toBe("POST");

    const body = bodyOf(0);
    expect(body.lead).toMatchObject({
      name: "Ana Vidal",
      email: "ana@sponsor.ch",
      ticketTypeId: "tt-asado",
    });
    expect(body.guests).toEqual([
      { name: "Bruno Keller", email: null, ticketTypeId: "tt-asado" },
      { name: "Chiara Bosco", email: null, ticketTypeId: "tt-child" },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it("turns a thirty-line paste into thirty editable rows and one create call", async () => {
    const user = userEvent.setup();
    renderGuestList();

    const names = Array.from({ length: 30 }, (_, i) => `Guest Number ${i + 1}`);

    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");
    await user.selectOptions(screen.getByLabelText("Default ticket type"), "tt-asado");

    await user.click(screen.getByLabelText("Paste guest names"));
    await user.paste(names.join("\n"));
    await user.click(screen.getByRole("button", { name: "Add pasted names" }));

    // Thirty rows, each editable: a name input and its own ticket-type select.
    expect(screen.getAllByLabelText(/^Guest \d+ name$/)).toHaveLength(30);
    expect(screen.getByLabelText("Guest 1 name")).toHaveValue("Guest Number 1");
    expect(screen.getByLabelText("Guest 30 name")).toHaveValue("Guest Number 30");

    // ...and correctable before submit.
    await user.clear(screen.getByLabelText("Guest 7 name"));
    await user.type(screen.getByLabelText("Guest 7 name"), "Corrected Name");

    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = bodyOf(0);
    expect(body.guests).toHaveLength(30);
    expect(body.guests[6].name).toBe("Corrected Name");
    expect(body.guests.every((g: { ticketTypeId: string }) => g.ticketTypeId === "tt-asado")).toBe(
      true
    );
  });

  it("flags a pasted row whose ticket type does not resolve and blocks submit", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");

    // No default ticket type picked → every pasted row carries an id that resolves to
    // no active ticket type of this event.
    await user.click(screen.getByLabelText("Paste guest names"));
    await user.paste("Bruno Keller\nChiara Bosco");
    await user.click(screen.getByRole("button", { name: "Add pasted names" }));

    expect(screen.getAllByLabelText(/^Guest \d+ name$/)).toHaveLength(2);
    expect(screen.getAllByText("Choose a ticket type")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Create guest list" }));
    expect(global.fetch).not.toHaveBeenCalled();

    // Fixing the flagged rows unblocks the submit — the paste is not thrown away.
    await user.selectOptions(screen.getByLabelText("Guest 1 ticket type"), "tt-asado");
    await user.selectOptions(screen.getByLabelText("Guest 2 ticket type"), "tt-child");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).guests).toHaveLength(2);
  });

  it("submits a guest row that has a name and no email", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");
    await user.selectOptions(screen.getByLabelText("Default ticket type"), "tt-asado");

    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Bruno Keller");

    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).guests).toEqual([
      { name: "Bruno Keller", email: null, ticketTypeId: "tt-asado" },
    ]);
  });

  it("fires one create request on a double-click", async () => {
    const user = userEvent.setup();

    let release: (value: unknown) => void = () => {};
    const inflight = new Promise((resolve) => {
      release = resolve;
    });
    global.fetch = vi.fn().mockReturnValue(
      inflight.then(() => ({ ok: true, status: 200, json: async () => ({ success: true }) }))
    );

    renderGuestList();
    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");

    const submit = screen.getByRole("button", { name: "Create guest list" });
    await user.dblClick(submit);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    release(null);
  });

  it("renders the server's message when the lead email is already registered (409)", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This email is already registered for this event" }),
    });

    renderGuestList();
    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(
      await screen.findByText("This email is already registered for this event")
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("warns before a create that would push the event past its cap", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuestList({ hasSeatCap: true, seatCap: 10, total: 10 });

    await user.type(screen.getByLabelText("Lead name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Lead email"), "ana@sponsor.ch");
    await user.selectOptions(screen.getByLabelText("Lead ticket type"), "tt-asado");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("11 / 10"));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("GuestList — maintaining an existing comp list", () => {
  function listRegion() {
    return within(screen.getByRole("region", { name: /Ana Vidal/ }));
  }

  it("adds a guest with an idempotency key and refreshes", async () => {
    const user = userEvent.setup();
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-child");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/ev-1/guest-list/reg-1/guests");
    expect(init.method).toBe("POST");

    const body = bodyOf(0);
    expect(body.guests).toEqual([
      { name: "Chiara Bosco", email: null, ticketTypeId: "tt-child" },
    ]);
    expect(typeof body.idempotencyKey).toBe("string");
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalled();
  });

  it("reuses the same idempotency key when a failed add is retried", async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "boom" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });

    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-child");
    await user.click(region.getByRole("button", { name: "Add guest" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();

    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).idempotencyKey).toBe(bodyOf(0).idempotencyKey);
  });

  it("mints a NEW idempotency key when the guest is edited after a failed add", async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      // The write may well have COMMITTED — the response was just lost. Replaying the same
      // key for a different guest would have the server return the prior batch's count and
      // write nothing, reporting success while silently dropping the edited guest.
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "boom" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });

    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Bruno Keller");
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-child");
    await user.click(region.getByRole("button", { name: "Add guest" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();

    // The admin corrects the row — a DIFFERENT guest now — and submits again.
    await user.clear(region.getByLabelText("Guest name"));
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).guests[0].name).toBe("Chiara Bosco");
    expect(bodyOf(1).idempotencyKey).not.toBe(bodyOf(0).idempotencyKey);
  });

  it("hides the remove control on the lead and on a checked-in guest", () => {
    renderGuestList({
      guestLists: [
        entry({
          people: [
            {
              ticketId: "t-lead",
              name: "Ana Vidal",
              email: "ana@sponsor.ch",
              ticketTypeTitle: "Asado",
              isLead: true,
              checkedIn: false,
            },
            {
              ticketId: "t-in",
              name: "Bruno Keller",
              email: null,
              ticketTypeTitle: "Asado",
              isLead: false,
              checkedIn: true,
            },
            {
              ticketId: "t-out",
              name: "Chiara Bosco",
              email: null,
              ticketTypeTitle: "Asado",
              isLead: false,
              checkedIn: false,
            },
          ],
        }),
      ],
    });

    const region = listRegion();
    expect(region.queryByRole("button", { name: "Remove Ana Vidal" })).not.toBeInTheDocument();
    expect(region.queryByRole("button", { name: "Remove Bruno Keller" })).not.toBeInTheDocument();
    expect(region.getByRole("button", { name: "Remove Chiara Bosco" })).toBeInTheDocument();
  });

  it("fires no request when the remove confirm is dismissed", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuestList({ guestLists: [entry()] });

    await user.click(listRegion().getByRole("button", { name: "Remove Bruno Keller" }));

    expect(confirm).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("DELETEs the guest's ticket once the confirm is accepted", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGuestList({ guestLists: [entry()] });

    await user.click(listRegion().getByRole("button", { name: "Remove Bruno Keller" }));

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/ev-1/guest-list/reg-1/guests");
    expect(init.method).toBe("DELETE");
    expect(bodyOf(0)).toEqual({ ticketId: "t-guest" });
    expect(refresh).toHaveBeenCalled();
  });

  it("resends the lead's tickets — the only delivery path for comp QRs", async () => {
    const user = userEvent.setup();
    renderGuestList({ guestLists: [entry()] });

    await user.click(listRegion().getByRole("button", { name: "Resend tickets" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/events/ev-1/registrations/reg-1/resend-confirmation",
      expect.objectContaining({ method: "POST" })
    );
    expect(refresh).toHaveBeenCalled();
  });
});
