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

// Rewritten for U5 (docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md) onto
// the new guest-list model: a list (name + contact) whose guests are registration-less
// tickets. No paste import (KD11), no seat-cap gate (adding a guest never touches
// capacity — R13/KTD4), and the single write surface is
// /api/admin/events/[id]/guest-lists.
//
// The old version of this file also exercised ManageEventTabs directly, to prove the
// "Guest list replaces Import" tab-bar wiring. That integration belongs to whichever unit
// wires the new `guestLists` shape into ManageEventTabs (U10's file, not this one's) —
// dropped here rather than left pinned to the old (registrationId/leadName/isLead) shape.

import GuestList, { type GuestListEntry } from "@/components/admin/GuestList";

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
  id: "list-1",
  listName: "Sponsor A",
  contactName: "Ana Vidal",
  contactEmail: "ana@sponsor.ch",
  contactPhone: null,
  people: [
    {
      ticketId: "t-guest",
      name: "Bruno Keller",
      email: null,
      ticketTypeId: "tt-asado",
      ticketTypeTitle: "Asado",
      checkedIn: false,
      alreadyHasTicket: false,
    },
  ],
  ...over,
});

function renderGuestList(over: Partial<Props> = {}) {
  const props: Props = {
    eventId: "ev-1",
    ticketTypes: TICKET_TYPES,
    guestLists: [],
    ...over,
  };
  return render(<GuestList {...props} />);
}

/** The body of the nth fetch call, parsed. */
function bodyOf(call: number) {
  const mock = global.fetch as ReturnType<typeof vi.fn>;
  return JSON.parse(mock.mock.calls[call][1].body as string);
}

function okFetch(payload: Record<string, unknown> = { success: true }) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
  global.fetch = okFetch();
});

describe("GuestList — creating a list", () => {
  it("posts a create-list request and refreshes", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("List name"), "Sponsor A");
    await user.type(screen.getByLabelText("Contact name"), "Ana Vidal");
    await user.type(screen.getByLabelText("Contact email"), "ana@sponsor.ch");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/ev-1/guest-lists");
    expect(init.method).toBe("POST");

    const body = bodyOf(0);
    expect(body).toMatchObject({
      type: "list",
      listName: "Sponsor A",
      contactName: "Ana Vidal",
      contactEmail: "ana@sponsor.ch",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("requires a list name before submitting", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("Contact name"), "Ana Vidal");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("The list needs a name.")).toBeInTheDocument();
  });

  it("requires a contact name before submitting", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("List name"), "Sponsor A");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("The list needs a contact name.")).toBeInTheDocument();
  });

  it("accepts a list with no contact email or phone", async () => {
    const user = userEvent.setup();
    renderGuestList();

    await user.type(screen.getByLabelText("List name"), "Sponsor A");
    await user.type(screen.getByLabelText("Contact name"), "Ana Vidal");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toMatchObject({ contactEmail: null, contactPhone: null });
  });

  it("renders the server's error message on failure", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Could not create the guest list" }),
    });
    renderGuestList();

    await user.type(screen.getByLabelText("List name"), "Sponsor A");
    await user.type(screen.getByLabelText("Contact name"), "Ana Vidal");
    await user.click(screen.getByRole("button", { name: "Create guest list" }));

    expect(await screen.findByText("Could not create the guest list")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("GuestList — adding a guest to an existing list", () => {
  function listRegion() {
    return within(screen.getByRole("region", { name: /Sponsor A/ }));
  }

  it("posts an add-guest request and refreshes", async () => {
    const user = userEvent.setup();
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-child");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/ev-1/guest-lists");
    expect(init.method).toBe("POST");

    const body = bodyOf(0);
    expect(body).toMatchObject({
      type: "guest",
      listId: "list-1",
      name: "Chiara Bosco",
      email: null,
      ticketTypeId: "tt-child",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("requires a name before submitting", async () => {
    const user = userEvent.setup();
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-child");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(region.getByText("The guest needs a name.")).toBeInTheDocument();
  });

  it("requires a ticket type before submitting", async () => {
    const user = userEvent.setup();
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(region.getByText("Choose a ticket type for this guest.")).toBeInTheDocument();
  });

  it("submits a guest with a name and no email", async () => {
    const user = userEvent.setup();
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-asado");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(bodyOf(0).email).toBeNull();
  });

  it("renders the server's error message on failure and does not refresh", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Unknown or archived ticket type for this event: tt-x" }),
    });
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    await user.type(region.getByLabelText("Guest name"), "Chiara Bosco");
    await user.selectOptions(region.getByLabelText("Guest ticket type"), "tt-child");
    await user.click(region.getByRole("button", { name: "Add guest" }));

    expect(
      await screen.findByText("Unknown or archived ticket type for this event: tt-x")
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows checked-in status on a guest, and no lead pill (there is no lead)", () => {
    renderGuestList({
      guestLists: [
        entry({
          people: [
            {
              ticketId: "t-in",
              name: "Bruno Keller",
              email: null,
              ticketTypeId: "tt-asado",
              ticketTypeTitle: "Asado",
              checkedIn: true,
              alreadyHasTicket: false,
            },
          ],
        }),
      ],
    });

    const region = listRegion();
    expect(region.getByText("Checked in")).toBeInTheDocument();
    expect(region.queryByText("Lead")).not.toBeInTheDocument();
  });

  it("flags a guest who already holds a purchased ticket (AE6), without hiding the row", () => {
    renderGuestList({
      guestLists: [
        entry({
          people: [
            {
              ticketId: "t-overlap",
              name: "Bruno Keller",
              email: null,
              ticketTypeId: "tt-asado",
              ticketTypeTitle: "Asado",
              checkedIn: false,
              alreadyHasTicket: true,
            },
          ],
        }),
      ],
    });

    const region = listRegion();
    expect(region.getByText("Bruno Keller")).toBeInTheDocument();
    expect(region.getByText("Already has a ticket")).toBeInTheDocument();
  });

  it("shows no overlap flag for an ordinary guest", () => {
    renderGuestList({ guestLists: [entry()] });

    const region = listRegion();
    expect(region.queryByText("Already has a ticket")).not.toBeInTheDocument();
  });
});

describe("GuestList — deleting a list", () => {
  function listRegion() {
    return within(screen.getByRole("region", { name: /Sponsor A/ }));
  }

  it("fires no request when the delete confirm is dismissed", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuestList({ guestLists: [entry()] });

    await user.click(listRegion().getByRole("button", { name: "Delete list" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("DELETEs the list once the confirm is accepted, and refreshes", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGuestList({ guestLists: [entry()] });

    await user.click(listRegion().getByRole("button", { name: "Delete list" }));

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/ev-1/guest-lists");
    expect(init.method).toBe("DELETE");
    expect(bodyOf(0)).toEqual({ listId: "list-1" });
    expect(refresh).toHaveBeenCalled();
  });

  it("renders the server's refusal when the list has a checked-in guest", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "This list has a checked-in guest and cannot be deleted — deleting it would erase their attendance history.",
      }),
    });
    renderGuestList({ guestLists: [entry()] });

    await user.click(listRegion().getByRole("button", { name: "Delete list" }));

    expect(
      await screen.findByText(
        "This list has a checked-in guest and cannot be deleted — deleting it would erase their attendance history."
      )
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
