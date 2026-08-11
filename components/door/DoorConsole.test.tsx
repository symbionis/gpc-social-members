// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

// The console polls router.refresh() on a 20s interval and refreshes after a save.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/common/PhoneInput", () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <input aria-label="Phone" disabled={disabled} />
  ),
}));

import DoorConsole from "@/components/door/DoorConsole";

type Props = React.ComponentProps<typeof DoorConsole>;
type Arrival = Props["arrivals"][number];
type NotArrived = Props["notArrived"][number];
type Party = Props["parties"][number];
type Slot = Party["slots"][number];

const slot = (over: Partial<Slot> = {}): Slot => ({
  attendeeId: "s1",
  name: "Ana Vidal",
  email: "ana@x.ch",
  phone: "+41790000001",
  ticketTypeId: "tt-1",
  ticketTypeTitle: "Asado",
  isLead: true,
  checkedIn: false,
  arrivedAt: null,
  ...over,
});

const party = (over: Partial<Party> = {}): Party => ({
  registrationId: "reg-1",
  referenceCode: "GPC-001",
  leadName: "Ana Vidal",
  quantity: 1,
  claimedCount: 1,
  remaining: 0,
  complete: true,
  isGuestList: false,
  slots: [slot()],
  ...over,
});

const arrival = (over: Partial<Arrival> = {}): Arrival => ({
  id: "a1",
  name: "Ana Vidal",
  partyName: "Ana Vidal",
  referenceCode: "GPC-001",
  ticketTypeTitle: "Asado",
  email: "ana@x.ch",
  phone: "+41790000001",
  arrivedAt: "2026-07-11T16:30:00Z", // 18:30 Geneva
  ...over,
});

const notArrived = (over: Partial<NotArrived> = {}): NotArrived => ({
  id: "n1",
  name: "Bruno Keller",
  partyName: "Keller Party",
  referenceCode: "GPC-002",
  ticketTypeTitle: "Asado",
  email: "bruno@x.ch",
  phone: "",
  ...over,
});

function renderConsole(over: Partial<Props> = {}) {
  const arrivals = over.arrivals ?? [];
  const missing = over.notArrived ?? [];
  return render(
    <DoorConsole
      eventId="evt-1"
      eventTitle="Summer Asado"
      eventDate="11 Jul 2026"
      parties={over.parties ?? []}
      arrivals={arrivals}
      notArrived={missing}
      arrivedCount={over.arrivedCount ?? arrivals.length}
      expectedCount={over.expectedCount ?? arrivals.length + missing.length}
      outstandingCount={over.outstandingCount ?? missing.length}
      unaccountedCount={over.unaccountedCount ?? 0}
    />
  );
}

const arrivalsTab = () => screen.getByRole("button", { name: /^Arrivals/ });
const arrivedView = () => screen.getByRole("button", { name: /^Arrived/ });
const notArrivedView = () => screen.getByRole("button", { name: /^Not arrived/ });
const rows = () => within(screen.getByTestId("arrivals-list")).getAllByRole("listitem");
const search = () => screen.getByPlaceholderText(/Search/i);

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("R14 — the arrivals list is complete", () => {
  it("renders every arrival, past the old eight-row cap", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 30 }, (_, i) =>
      arrival({
        id: `a${i + 1}`,
        name: `Guest ${i + 1}`,
        partyName: `Party ${i + 1}`,
        referenceCode: `GPC-${i + 1}`,
      })
    );
    renderConsole({ arrivals: many });
    await user.click(arrivalsTab());
    expect(rows()).toHaveLength(30);
    // The ninth row is the one the old `arrivals.slice(0, 8)` cap dropped.
    expect(screen.getByText("Guest 9")).toBeInTheDocument();
    expect(screen.getByText("Guest 30")).toBeInTheDocument();
  });
});

describe("R15 — one shared matcher across both views", () => {
  const arrivals = [
    arrival({ id: "a1", name: "Ana Vidal", partyName: "Ana Vidal", referenceCode: "GPC-001", email: "ana@x.ch" }),
    arrival({ id: "a2", name: "Carla Rossi", partyName: "Ana Vidal", referenceCode: "GPC-001", email: "carla@x.ch" }),
    arrival({ id: "a3", name: "Dan Meier", partyName: "Zoe Blanc", referenceCode: "GPC-009", email: "dan@x.ch" }),
  ];
  const missing = [
    notArrived({ id: "n1", name: "Bruno Keller", partyName: "Ana Vidal", referenceCode: "GPC-001", email: "bruno@x.ch" }),
    notArrived({ id: "n2", name: "Elle Faure", partyName: "Zoe Blanc", referenceCode: "GPC-009", email: "elle@x.ch" }),
  ];

  it("filters arrivals by guest name, party name, reference code and email", async () => {
    const user = userEvent.setup();
    renderConsole({ arrivals, notArrived: missing });
    await user.click(arrivalsTab());

    await user.type(search(), "carla");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Carla Rossi")).toBeInTheDocument();

    await user.clear(search());
    await user.type(search(), "zoe blanc"); // party name
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Dan Meier")).toBeInTheDocument();

    await user.clear(search());
    await user.type(search(), "gpc-001"); // reference code
    expect(rows()).toHaveLength(2);

    await user.clear(search());
    await user.type(search(), "dan@x.ch"); // email
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Dan Meier")).toBeInTheDocument();
  });

  it("applies the same query to the not-arrived view", async () => {
    const user = userEvent.setup();
    renderConsole({ arrivals, notArrived: missing });
    await user.click(arrivalsTab());
    await user.type(search(), "gpc-009"); // Dan (arrived) + Elle (not arrived)
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Dan Meier")).toBeInTheDocument();

    await user.click(notArrivedView());
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Elle Faure")).toBeInTheDocument();
    expect(screen.queryByText("Bruno Keller")).not.toBeInTheDocument();
  });

  it("carries the query across a tab switch", async () => {
    const user = userEvent.setup();
    renderConsole({ parties: [party()], arrivals, notArrived: missing });
    await user.click(arrivalsTab());
    await user.type(search(), "carla");
    await user.click(screen.getByRole("button", { name: /^Attendees/ }));
    expect(search()).toHaveValue("carla");
  });
});

describe("R16 — an arrival row carries party, ticket type and time", () => {
  it("shows name, party, ticket type and arrival time", async () => {
    const user = userEvent.setup();
    renderConsole({
      arrivals: [
        arrival({ name: "Carla Rossi", partyName: "Ana Vidal", ticketTypeTitle: "Asado" }),
      ],
    });
    await user.click(arrivalsTab());
    const row = rows()[0];
    expect(within(row).getByText("Carla Rossi")).toBeInTheDocument();
    expect(within(row).getByText("Ana Vidal")).toBeInTheDocument();
    expect(within(row).getByText("Asado")).toBeInTheDocument();
    expect(within(row).getByText(/18:30/)).toBeInTheDocument();
  });

});

describe("R17 — the not-arrived view", () => {
  it("lists named no-shows and open slots, and excludes arrivals", async () => {
    const user = userEvent.setup();
    renderConsole({
      arrivals: [arrival({ name: "Ana Vidal" })],
      notArrived: [
        notArrived({ id: "n1", name: "Bruno Keller", partyName: "Keller Party" }),
        notArrived({ id: "n2", name: null, partyName: "Zoe Blanc", ticketTypeTitle: "Kids" }),
      ],
    });
    await user.click(arrivalsTab());
    await user.click(notArrivedView());
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("Bruno Keller")).toBeInTheDocument();
    // An unnamed issued slot renders as an "Open slot" row with its party + type.
    const open = rows()[1];
    expect(within(open).getByText("Open slot")).toBeInTheDocument();
    expect(within(open).getByText("Zoe Blanc")).toBeInTheDocument();
    expect(within(open).getByText("Kids")).toBeInTheDocument();
    expect(screen.queryByText("Ana Vidal")).not.toBeInTheDocument();
  });
});

describe("R18 — reconciled counts", () => {
  it("shows arrived / expected / outstanding, and outstanding equals the not-arrived length", async () => {
    const user = userEvent.setup();
    renderConsole({
      arrivals: [arrival({ id: "a1" }), arrival({ id: "a2", name: "Carla Rossi" })],
      notArrived: [
        notArrived({ id: "n1", name: "Bruno Keller" }),
        notArrived({ id: "n2", name: "Elle Faure" }),
        notArrived({ id: "n3", name: null, partyName: "Zoe Blanc" }),
      ],
      arrivedCount: 2,
      expectedCount: 5,
      outstandingCount: 3,
    });
    await user.click(arrivalsTab());
    const counts = screen.getByTestId("arrival-counts");
    expect(counts).toHaveTextContent("2");
    expect(counts).toHaveTextContent(/5 expected/);
    expect(counts).toHaveTextContent(/3 outstanding/);

    await user.click(notArrivedView());
    expect(rows()).toHaveLength(3); // outstanding === notArrived.length (KTD8)
  });
});

describe("unaccounted seats are visible at the door", () => {
  it("shows no warning when every seat sold has a row on the roster", async () => {
    const user = userEvent.setup();
    renderConsole({
      arrivals: [arrival()],
      notArrived: [notArrived()],
      arrivedCount: 1,
      expectedCount: 2,
      outstandingCount: 1,
      unaccountedCount: 0,
    });
    await user.click(arrivalsTab());
    expect(screen.queryByTestId("unaccounted-warning")).not.toBeInTheDocument();
  });

  it("warns with the count when seats sold have no row anywhere on the roster", async () => {
    const user = userEvent.setup();
    renderConsole({
      arrivals: [arrival()],
      notArrived: [notArrived()],
      arrivedCount: 1,
      expectedCount: 5,
      outstandingCount: 1,
      unaccountedCount: 3,
    });
    await user.click(arrivalsTab());
    const warning = screen.getByTestId("unaccounted-warning");
    expect(warning).toHaveTextContent("3 expected guests have no row on this roster");
    expect(warning).toHaveTextContent(/welcome desk/i);
  });
});

describe("arrivals tab states", () => {
  it("says so when nobody has arrived yet", async () => {
    const user = userEvent.setup();
    renderConsole({ notArrived: [notArrived()] });
    await user.click(arrivalsTab());
    expect(screen.getByText(/No arrivals yet/i)).toBeInTheDocument();
  });

  it("says everyone expected is in when nobody is outstanding", async () => {
    const user = userEvent.setup();
    renderConsole({ arrivals: [arrival()], notArrived: [] });
    await user.click(arrivalsTab());
    await user.click(notArrivedView());
    expect(screen.getByText(/Everyone expected is in/i)).toBeInTheDocument();
  });

  it("surfaces a cross-view match control that switches view and keeps the query", async () => {
    const user = userEvent.setup();
    renderConsole({
      arrivals: [arrival({ name: "Ana Vidal" })],
      notArrived: [notArrived({ name: "Bruno Keller", partyName: "Keller Party" })],
    });
    await user.click(arrivalsTab());
    await user.type(search(), "bruno");
    const jump = screen.getByRole("button", { name: /1 match in Not arrived/i });
    await user.click(jump);
    expect(search()).toHaveValue("bruno");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Bruno Keller")).toBeInTheDocument();
  });

  it("falls back to the welcome-desk copy when nothing matches in either view", async () => {
    const user = userEvent.setup();
    renderConsole({ arrivals: [arrival()], notArrived: [notArrived()] });
    await user.click(arrivalsTab());
    await user.type(search(), "nobody");
    expect(screen.getByText(/welcome desk/i)).toBeInTheDocument();
  });
});

describe("R12 — comp guests are findable in the Attendees tab", () => {
  it("finds a comp party's named guest by guest name", async () => {
    const user = userEvent.setup();
    const comp = party({
      registrationId: "reg-comp",
      referenceCode: "GPC-COMP",
      leadName: "Cardis Sponsor",
      quantity: 2,
      claimedCount: 2,
      remaining: 0,
      slots: [
        slot({ attendeeId: "c1", name: "Cardis Sponsor", isLead: true }),
        slot({
          attendeeId: "c2",
          name: "Marta Lopez",
          email: "",
          phone: "",
          isLead: false,
        }),
      ],
    });
    renderConsole({ parties: [comp, party()] });
    await user.type(search(), "marta");
    expect(screen.getByText("Cardis Sponsor")).toBeInTheDocument();
    expect(screen.queryByText("Ana Vidal")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Marta Lopez")).toBeInTheDocument();
  });
});

describe("open slots (self-registration retired, U16)", () => {
  // Self-registration is gone; open slots are named via the door's own SlotRow forms. A
  // comp party's open seats still route staff to the welcome desk (they're the sponsor's).
  const withOpenSlot = (over: Partial<Party>) =>
    party({
      quantity: 2,
      claimedCount: 1,
      remaining: 1,
      complete: false,
      slots: [slot(), slot({ attendeeId: null, name: "", email: "", phone: "", isLead: false })],
      ...over,
    });

  it("routes staff to the welcome desk before filling a comp party's open seat", () => {
    renderConsole({ parties: [withOpenSlot({ isGuestList: true })] });
    expect(screen.getByText(/welcome desk/i)).toBeInTheDocument();
    expect(screen.getByText(/comped seats/i)).toBeInTheDocument();
  });

  it("prompts staff to name a non-comp party's open seats, with no self-reg link", () => {
    renderConsole({ parties: [withOpenSlot({ isGuestList: false })] });
    expect(screen.getByText(/still to name/i)).toBeInTheDocument();
    expect(screen.queryByText(/pre-registration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/self-registration/i)).not.toBeInTheDocument();
  });
});

describe("R13 — contact capture at check-in", () => {
  it("leaves a claimed slot that already has contact locked behind Edit details", () => {
    renderConsole({ parties: [party()] });
    expect(screen.getByDisplayValue("Ana Vidal")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("renders a contactless claimed slot's fields unlocked for capture", () => {
    const comp = party({
      leadName: "Cardis Sponsor",
      slots: [slot({ attendeeId: "c2", name: "Marta Lopez", email: "", phone: "", isLead: false })],
    });
    renderConsole({ parties: [comp] });
    expect(screen.getByDisplayValue("Marta Lopez")).toBeEnabled();
    expect(screen.getByPlaceholderText("Email")).toBeEnabled();
    expect(screen.getByLabelText("Phone")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });
});

describe("U7 — the door asks a comp guest for an email", () => {
  // AE4: a ticket with no email is prompted at check-in, even when it already carries
  // a phone — email is specifically what the follow-up needs (R7).
  it("opens contact fields and prompts for an email when a phone-only slot is checked in", () => {
    const comp = party({
      leadName: "Cardis Sponsor",
      slots: [
        slot({ attendeeId: "c2", name: "Marta Lopez", email: "", phone: "+41790000009", isLead: false }),
      ],
    });
    renderConsole({ parties: [comp] });
    expect(screen.getByDisplayValue("Marta Lopez")).toBeEnabled();
    expect(screen.getByPlaceholderText("Email")).toBeEnabled();
    expect(screen.getByText(/No email on file/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  it("does not prompt a slot that already has an email, even with no phone", () => {
    const comp = party({
      leadName: "Cardis Sponsor",
      slots: [
        slot({ attendeeId: "c2", name: "Marta Lopez", email: "marta@x.ch", phone: "", isLead: false }),
      ],
    });
    renderConsole({ parties: [comp] });
    expect(screen.getByDisplayValue("Marta Lopez")).toBeDisabled();
    expect(screen.queryByText(/No email on file/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("lets a guest who declines an email be dismissed with Cancel, and still checked in", async () => {
    const user = userEvent.setup();
    const comp = party({
      leadName: "Cardis Sponsor",
      slots: [
        slot({ attendeeId: "c2", name: "Marta Lopez", email: "", phone: "", isLead: false }),
      ],
    });
    renderConsole({ parties: [comp] });

    // The declining guest's row must offer a dismiss control even with no contact.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeEnabled();
    await user.click(cancel);

    // Admission is unconditional on the form — the top-level Check in button is
    // present and usable regardless of whether an email was ever supplied.
    const checkIn = screen.getByRole("button", { name: "Check in" });
    expect(checkIn).toBeEnabled();
    await user.click(checkIn);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/check-in"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("a phone-only guest still saves through the client (declining email doesn't block save)", async () => {
    const user = userEvent.setup();
    const comp = party({
      leadName: "Cardis Sponsor",
      // Phone already on file, no email: prompted (per R7) but must still be
      // saveable on phone alone — tightening save would refuse this ordinary case.
      slots: [
        slot({ attendeeId: "c2", name: "Marta Lopez", email: "", phone: "+41790000009", isLead: false }),
      ],
    });
    renderConsole({ parties: [comp] });

    const nameInput = screen.getByDisplayValue("Marta Lopez");
    await user.clear(nameInput);
    await user.type(nameInput, "Marta L. Lopez");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/save-attendee"),
      expect.objectContaining({
        body: expect.not.stringContaining('"email"'),
      })
    );
  });

  it("normalises and saves an email typed at the door", async () => {
    const user = userEvent.setup();
    const comp = party({
      leadName: "Cardis Sponsor",
      slots: [
        slot({ attendeeId: "c2", name: "Marta Lopez", email: "", phone: "+41790000009", isLead: false }),
      ],
    });
    renderConsole({ parties: [comp] });

    const emailInput = screen.getByPlaceholderText("Email");
    await user.type(emailInput, "  Marta@X.CH  ");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/save-attendee"),
      expect.objectContaining({
        body: expect.stringContaining('"email":"Marta@X.CH"'),
      })
    );
  });

  it("prompts identically in the Guest lists tab and the Attendees tab", async () => {
    const user = userEvent.setup();
    const noEmailSlot = slot({ attendeeId: "c2", name: "Marta Lopez", email: "", phone: "", isLead: false });
    const comp = party({ leadName: "Cardis Sponsor", isGuestList: true, slots: [noEmailSlot] });
    const attendeeParty = party({
      registrationId: "reg-attendee",
      leadName: "Walk-up Wendy",
      slots: [slot({ attendeeId: "w1", name: "Wendy Fell", email: "", phone: "", isLead: true })],
    });

    renderConsole({ parties: [comp, attendeeParty] });
    // Attendees tab shows every party, including guest-list ones (R12) — both
    // no-email slots are prompted identically there.
    expect(screen.getAllByText(/No email on file/i)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));
    const panel = screen.getByTestId("door-guest-lists");
    expect(within(panel).getByText(/No email on file/i)).toBeInTheDocument();
  });
});

describe("Guest lists tab", () => {
  const cardis = () =>
    party({
      registrationId: "reg-cardis",
      referenceCode: "GPC-CARDIS",
      leadName: "Cardis Sponsor",
      isGuestList: true,
      quantity: 3,
      slots: [
        slot({
          attendeeId: "g1",
          name: "Ana Vidal",
          checkedIn: true,
          arrivedAt: "2026-08-19T18:04:00Z",
        }),
        slot({ attendeeId: "g2", name: "Bruno Keller", isLead: false }),
        slot({ attendeeId: "g3", name: "", isLead: false }),
      ],
    });

  it("offers no tab when the event has no sponsor lists", () => {
    renderConsole({ parties: [party()] });
    expect(screen.queryByRole("button", { name: /Guest lists/ })).toBeNull();
  });

  it("groups a sponsor's guests under that sponsor with an arrived count", async () => {
    const user = userEvent.setup();
    renderConsole({ parties: [cardis(), party()] });

    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));

    const list = screen.getByTestId("door-guest-list");
    expect(within(list).getByText("Cardis Sponsor")).toBeInTheDocument();
    expect(within(list).getByText("GPC-CARDIS")).toBeInTheDocument();
    // The sponsor's whole list read as one unit — the point of the tab.
    expect(within(list).getByText("1 of 3 arrived")).toBeInTheDocument();
    expect(within(list).getByDisplayValue("Ana Vidal")).toBeInTheDocument();
    expect(within(list).getByDisplayValue("Bruno Keller")).toBeInTheDocument();
  });

  it("checks a comp guest in from the list itself", async () => {
    // A comp list often has no emails, so those guests never get a ticket and arrive with no
    // QR. This list is how they are admitted, not just a view of who was invited.
    const user = userEvent.setup();
    renderConsole({ parties: [cardis()] });
    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));

    const panel = screen.getByTestId("door-guest-lists");
    // Ana already arrived; Bruno and the open slot have not.
    expect(within(panel).getAllByRole("button", { name: "Check in" }).length).toBeGreaterThan(0);
  });

  it("opens contact fields for a comp guest who has no email", async () => {
    // A comp list often carries no emails. The door is the one moment that gap can be closed,
    // so the row starts unlocked rather than hiding the fields behind Edit details.
    const user = userEvent.setup();
    const list = party({
      leadName: "Cardis Sponsor",
      isGuestList: true,
      slots: [slot({ attendeeId: "g1", name: "Marta Lopez", email: "", phone: "", isLead: false })],
    });
    renderConsole({ parties: [list] });
    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));

    const panel = screen.getByTestId("door-guest-lists");
    expect(within(panel).getByDisplayValue("Marta Lopez")).toBeEnabled();
    expect(within(panel).getByPlaceholderText("Email")).toBeEnabled();
    expect(within(panel).queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("leaves a comp guest who already gave an email locked", async () => {
    // Capture is offered only where the contact is missing — not as a prompt on every guest.
    const user = userEvent.setup();
    const list = party({
      leadName: "Cardis Sponsor",
      isGuestList: true,
      slots: [
        slot({ attendeeId: "g1", name: "Marta Lopez", email: "marta@x.ch", isLead: false }),
      ],
    });
    renderConsole({ parties: [list] });
    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));

    const panel = screen.getByTestId("door-guest-lists");
    expect(within(panel).getByDisplayValue("Marta Lopez")).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("puts the waiver in front of a comp guest before admitting them", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "needs_waiver" }),
    });
    const list = party({
      leadName: "Cardis Sponsor",
      isGuestList: true,
      slots: [
        slot({ attendeeId: "g1", name: "Marta Lopez", email: "marta@x.ch", isLead: false }),
      ],
    });
    renderConsole({ parties: [list] });
    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));
    await user.click(screen.getByRole("button", { name: "Check in" }));

    // A comped seat is still a person at an event with a waiver requirement.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Terms & waiver")).toBeInTheDocument();
    // Named, because the clerk is working a queue and needs to know whose waiver this is.
    expect(within(dialog).getByText("Marta Lopez")).toBeInTheDocument();
  });

  it("opens the waiver as a modal over the roster, not a box inside the row", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "needs_waiver" }),
    });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    await user.click(screen.getByRole("button", { name: "Check in" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Portalled to the body: a `fixed` overlay nested inside the roster stops covering the
    // viewport the moment any ancestor gains a transform.
    expect(dialog.parentElement).toBe(document.body);
  });

  it("closes the waiver without checking anyone in", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "needs_waiver" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    await user.click(screen.getByRole("button", { name: "Check in" }));
    await screen.findByRole("dialog");

    const callsBefore = fetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    // Dismissing signs nothing, so it must not admit them.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  // The affirmation is a separate act from the button. A phone gets passed between people at
  // the door; a stray tap must not be able to accept a liability waiver on someone's behalf.
  it("will not check in until the guest ticks the acceptance box", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "needs_waiver" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    await user.click(screen.getByRole("button", { name: "Check in" }));
    const dialog = await screen.findByRole("dialog");

    const accept = within(dialog).getByRole("button", { name: "Accept" });
    expect(accept).toBeDisabled();

    fetchMock.mockClear();
    await user.click(accept);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    expect(accept).toBeEnabled();
  });

  it("accepts the waiver and checks in from inside the modal", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "needs_waiver" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    await user.click(screen.getByRole("button", { name: "Check in" }));
    const dialog = await screen.findByRole("dialog");

    fetchMock.mockClear();
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // The guest's own language and consent choices ride along, sourced from the modal so the
    // scan path cannot answer them differently.
    expect(body).toMatchObject({
      ticketId: "a1",
      waiverAccepted: true,
      language: "en",
      marketingConsent: true,
    });
  });

  // A refusal from this route arrives as HTTP 200 with a status, not as a non-2xx. The handler
  // used to treat everything that was not needs_waiver as success, so the server could say NO
  // and the operator would see the row refresh and hand over a bracelet.
  //
  // The positive control below is what stops these three passing vacuously: on a real check-in
  // the console MUST still refresh.
  it("admits and refreshes on a genuine check-in", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "checked_in" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    refresh.mockClear();
    await user.click(screen.getByRole("button", { name: "Check in" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("does NOT admit on a 200 not_recognised, and says not to", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "not_recognised" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    refresh.mockClear();
    await user.click(screen.getByRole("button", { name: "Check in" }));

    expect(refresh).not.toHaveBeenCalled();
    // The operator has to be told not to admit — a silently unchanged row is a clue they will
    // miss with a queue behind the guest.
    expect(await screen.findByText(/Do not admit/i)).toBeInTheDocument();
    // not_recognised covers a CANCELLED ticket as well as an unknown one, so the message must
    // not tell the operator it is merely unrecognised.
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });

  // The worst version: the guest has already read and ticked the waiver on the operator's
  // phone. Nothing was written — not the check-in and not the acceptance — so the modal must
  // not close as though it had been.
  it("does NOT admit when not_recognised comes back after the waiver was accepted", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "needs_waiver" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    await user.click(screen.getByRole("button", { name: "Check in" }));
    const dialog = await screen.findByRole("dialog");

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "not_recognised" }) });
    refresh.mockClear();
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    expect(refresh).not.toHaveBeenCalled();
    expect(await screen.findByText(/Do not admit/i)).toBeInTheDocument();
  });

  // A status this screen does not know is a refusal, never an admission — and it is logged,
  // because otherwise the only symptom is a door that quietly stops working for one guest.
  it("refuses, and logs, a status it does not recognise", async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "quarantined" }) });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    refresh.mockClear();
    await user.click(screen.getByRole("button", { name: "Check in" }));

    expect(refresh).not.toHaveBeenCalled();
    expect(await screen.findByText(/Could not check in/i)).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unrecognised status"),
      expect.objectContaining({ status: "quarantined" })
    );
    errorSpy.mockRestore();
  });

  it("translates the whole modal, not just the waiver body", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "needs_waiver" }),
    });
    renderConsole({
      parties: [party({ slots: [slot({ attendeeId: "a1", name: "Ana Vidal" })] })],
    });
    await user.click(screen.getByRole("button", { name: "Check in" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "FR" }));

    // Previously the body switched to French under English instructions.
    expect(within(dialog).getByText("Conditions et décharge")).toBeInTheDocument();
    expect(within(dialog).getByText(/J'ai lu et j'accepte/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Accepter" })).toBeInTheDocument();
  });

  // The one piece of modal state that must never persist: a tick left over from the previous
  // guest would admit this one on a stranger's acceptance.
  it("clears the acceptance tick between guests", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "needs_waiver" }) });
    renderConsole({
      parties: [
        party({
          slots: [
            slot({ attendeeId: "a1", name: "Ana Vidal" }),
            slot({ attendeeId: "a2", name: "Ben Torres", isLead: false }),
          ],
        }),
      ],
    });

    const [first, second] = screen.getAllByRole("button", { name: "Check in" });
    await user.click(first);
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(second);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /I have read and accept/i })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  it("shows an already-arrived guest as arrived rather than offering check-in again", async () => {
    const user = userEvent.setup();
    renderConsole({ parties: [cardis()] });
    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));
    expect(within(screen.getByTestId("door-guest-lists")).getByText(/^arrived/)).toBeInTheDocument();
  });

  it("leaves ordinary parties out of the tab", async () => {
    const user = userEvent.setup();
    renderConsole({ parties: [cardis(), party({ leadName: "Walk-up Wendy" })] });
    await user.click(screen.getByRole("button", { name: "Guest lists (1)" }));
    expect(screen.getAllByTestId("door-guest-list")).toHaveLength(1);
    expect(screen.queryByText("Walk-up Wendy")).toBeNull();
  });
});
