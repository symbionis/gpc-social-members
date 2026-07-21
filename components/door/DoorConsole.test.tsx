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
  selfRegToken: null,
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
      baseUrl="https://gpc.test"
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
    await user.click(screen.getByRole("button", { name: /^Pre-registered/ }));
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

describe("R12 — comp guests are findable in the Pre-registered tab", () => {
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

describe("open slots with no self-registration link", () => {
  // A comp party's self_reg_token is NULL by design, so the "predates the feature" copy
  // is a lie for it — and it must not read as an invitation to fill a sponsor's seat.
  const withOpenSlot = (over: Partial<Party>) =>
    party({
      quantity: 2,
      claimedCount: 1,
      remaining: 1,
      complete: false,
      selfRegToken: null,
      slots: [slot(), slot({ attendeeId: null, name: "", email: "", phone: "", isLead: false })],
      ...over,
    });

  it("tells the volunteer a comp party has no link BY DESIGN", () => {
    renderConsole({ parties: [withOpenSlot({ isGuestList: true })] });
    expect(screen.getByText(/no self-registration link by design/i)).toBeInTheDocument();
    expect(screen.getByText(/welcome desk/i)).toBeInTheDocument();
    expect(screen.queryByText(/predates the feature/i)).not.toBeInTheDocument();
  });

  it("keeps the legacy-booking copy for a non-comp party", () => {
    renderConsole({ parties: [withOpenSlot({ isGuestList: false })] });
    expect(screen.getByText(/predates the feature/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/no self-registration link by design/i)
    ).not.toBeInTheDocument();
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
