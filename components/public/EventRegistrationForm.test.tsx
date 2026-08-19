// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/components/common/PhoneInput", () => ({
  default: () => <input aria-label="Phone" />,
}));

import EventRegistrationForm, {
  type OfferMode,
  type TicketTypeOption,
} from "@/components/public/EventRegistrationForm";

const asado: TicketTypeOption = { id: "a", title: "Asado", price: 80 };
const veg: TicketTypeOption = { id: "v", title: "Veg", price: 40 };
const kids: TicketTypeOption = { id: "k", title: "Kids", price: 0 };
const soon: TicketTypeOption = { id: "n", title: "Soon", price: null };

function renderForm(ticketTypes: TicketTypeOption[], props: Partial<React.ComponentProps<typeof EventRegistrationForm>> = {}) {
  return render(<EventRegistrationForm eventId="evt-1" ticketTypes={ticketTypes} {...props} />);
}

const yourTicket = (title: string) => screen.getByLabelText(`${title} ticket for you`);

async function fillBuyer(user: ReturnType<typeof userEvent.setup>, first = "Frank", last = "Sykes", email = "frank@x.ch") {
  await user.type(screen.getByLabelText("First name"), first);
  await user.type(screen.getByLabelText("Last name"), last);
  await user.type(screen.getByLabelText("Email"), email);
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "stop" }) });
});

describe("step 1 — the buyer's own tickets", () => {
  it("renders one checkbox per selectable type and no dropdown", () => {
    renderForm([asado, veg, kids]);
    expect(yourTicket("Asado")).toBeInTheDocument();
    expect(yourTicket("Veg")).toBeInTheDocument();
    expect(yourTicket("Kids")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows a null-priced type as 'Not open yet' with no checkbox", () => {
    renderForm([asado, soon]);
    expect(screen.getByText("Not open yet")).toBeInTheDocument();
    expect(screen.queryByLabelText("Soon ticket for you")).not.toBeInTheDocument();
  });

  it("keeps Continue disabled until the buyer picks a ticket for themselves", async () => {
    const user = userEvent.setup();
    renderForm([asado, kids]);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await user.click(yourTicket("Kids")); // a former child type is sufficient on its own
    expect(cont).toBeEnabled();
  });

  it("reflects the running total from the buyer's own selection", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(yourTicket("Asado"));
    expect(screen.getByText("CHF 80.00", { selector: "span.font-heading" })).toBeInTheDocument();
  });

  // One ticket per head: step 1 is a radio group, so a second pick REPLACES the first
  // rather than adding to it. The total reflects the swap, never the sum.
  it("replaces the buyer's ticket when they pick a second type, rather than adding it", async () => {
    const user = userEvent.setup();
    renderForm([asado, veg]);
    await user.click(yourTicket("Asado"));
    await user.click(yourTicket("Veg"));
    expect(screen.getByText("CHF 40.00", { selector: "span.font-heading" })).toBeInTheDocument();
    expect(yourTicket("Veg")).toBeChecked();
    expect(yourTicket("Asado")).not.toBeChecked();
  });

  it("tells the buyer guests are booked on the next screen", () => {
    renderForm([asado]);
    expect(screen.getByText(/book tickets for guests on the next screen/i)).toBeInTheDocument();
  });

  // Swapping is free even at the cap — it exchanges a ticket rather than adding one.
  // Only a person with nothing selected can be blocked, which for the buyer at cap 1
  // means never, since they are the first pick.
  it("lets the buyer swap their ticket even when the order cap is 1", async () => {
    const user = userEvent.setup();
    renderForm([asado, veg], { maxQuantity: 1 });
    await user.click(yourTicket("Asado"));
    expect(yourTicket("Veg")).toBeEnabled();
    await user.click(yourTicket("Veg"));
    expect(yourTicket("Veg")).toBeChecked();
    expect(screen.getByText(/Maximum 1 tickets/i)).toBeInTheDocument();
  });

  it("blocks a guest row's first pick once the order cap is reached", async () => {
    const user = userEvent.setup();
    renderForm([asado, veg], { maxQuantity: 1 });
    await fillBuyer(user);
    await user.click(yourTicket("Asado"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // The cap is already consumed by the buyer, so "Add guest" is closed off entirely.
    expect(screen.getByRole("button", { name: /add guest/i })).toBeDisabled();
  });
});

describe("ticket-type description display", () => {
  it("renders a type's description beside its title", () => {
    renderForm([{ ...asado, description: "Includes welcome drink + seated dinner" }]);
    expect(screen.getByText("Includes welcome drink + seated dinner")).toBeInTheDocument();
  });

  it("renders no description element when a type has none", () => {
    renderForm([{ ...veg, description: null }]);
    expect(screen.queryByText(/includes/i)).not.toBeInTheDocument();
    expect(yourTicket("Veg")).toBeInTheDocument();
  });

  it("renders a script-like description as inert escaped text (no HTML injection)", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = renderForm([{ ...asado, description: payload }]);
    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("step 2 — repeatable guest rows (R20)", () => {
  async function goToStep2(user: ReturnType<typeof userEvent.setup>, types: string[] = ["Asado"]) {
    await fillBuyer(user);
    for (const t of types) await user.click(yourTicket(t));
    await user.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("the buyer sees their own ticket summarised, not a guest row demanding their details again", async () => {
    const user = userEvent.setup();
    renderForm([asado, veg]);
    await goToStep2(user, ["Veg"]);
    expect(screen.getByText("Who's coming?")).toBeInTheDocument();
    expect(screen.getByText("Veg")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Guest 1/)).not.toBeInTheDocument();
  });

  it("starts with zero guest rows; 'Add guest' appends a repeatable row", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await goToStep2(user);
    expect(screen.queryByLabelText(/Guest 1 first name/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    expect(screen.getByLabelText("Guest 1 first name")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    expect(screen.getByLabelText("Guest 2 first name")).toBeInTheDocument();
  });

  it("Remove takes a guest row back out", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: "Remove guest 1" }));
    expect(screen.queryByLabelText(/Guest 1 first name/)).not.toBeInTheDocument();
  });

  it("covers R5/KD5: three invalid guest rows all show errors simultaneously, not just the first", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    // Guest 1: no name, no email, no ticket. Guest 2: name but no ticket type. Guest 3: name + type but bad email.
    await user.type(screen.getByLabelText("Guest 2 first name"), "Ben");
    await user.type(screen.getByLabelText("Guest 2 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 2 email"), "ben@x.ch");
    await user.type(screen.getByLabelText("Guest 3 first name"), "Cara");
    await user.type(screen.getByLabelText("Guest 3 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 3 email"), "not-an-email");
    await user.click(screen.getByLabelText("Guest 3 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));

    expect(global.fetch).not.toHaveBeenCalled();
    // Guest 1: missing name + missing ticket type.
    expect(screen.getByText("Each person needs a name")).toBeInTheDocument();
    // Guest 1 AND Guest 2 both have no ticket types selected.
    expect(screen.getAllByText("Each person needs at least one ticket")).toHaveLength(2);
    // Guest 3: invalid email.
    expect(screen.getByText("Each person needs a valid email")).toBeInTheDocument();
  });

  it("covers R4: a shared email across two guests is accepted", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, reference_code: "R1" }) });
    renderForm([asado, veg]);
    await goToStep2(user, ["Asado"]);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Ana");
    await user.type(screen.getByLabelText("Guest 1 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "shared@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.type(screen.getByLabelText("Guest 2 first name"), "Ben");
    await user.type(screen.getByLabelText("Guest 2 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 2 email"), "shared@x.ch");
    await user.click(screen.getByLabelText("Guest 2 Veg ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    expect(global.fetch).toHaveBeenCalled();
    expect(screen.queryByText(/already have a seat/i)).not.toBeInTheDocument();
  });

  it("blocks the buyer from naming themselves onto a second seat of their own ticket type", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await goToStep2(user, ["Asado"]);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Frank");
    await user.type(screen.getByLabelText("Guest 1 last name"), "Sykes");
    await user.type(screen.getByLabelText("Guest 1 email"), "frank@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    expect(screen.getByText(/already holds this ticket type/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows the buyer's name on a guest row of a different ticket type", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, reference_code: "R1" }) });
    renderForm([asado, veg]);
    await goToStep2(user, ["Asado"]);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Frank");
    await user.type(screen.getByLabelText("Guest 1 last name"), "Sykes");
    await user.type(screen.getByLabelText("Guest 1 email"), "frank@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Veg ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    expect(screen.queryByText(/already holds this ticket type/i)).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalled();
  });

  it("submits the buyer as people[0] and each guest as a following entry, carrying their ticket types", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, reference_code: "R1" }) });
    renderForm([asado, veg]);
    await goToStep2(user, ["Asado"]);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Ana");
    await user.type(screen.getByLabelText("Guest 1 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Veg ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.name).toBe("Frank Sykes");
    expect(body.email).toBe("frank@x.ch");
    expect(body.people).toEqual([
      { name: "Frank Sykes", email: "frank@x.ch", ticketTypeIds: ["a"] },
      { name: "Ana Adult", email: "ana@x.ch", ticketTypeIds: ["v"] },
    ]);
    expect(body.items).toBeUndefined();
    expect(body.attendees).toBeUndefined();
    expect(body.leadTicketTypeId).toBeUndefined();
  });

  it("Back preserves the buyer's selection and typed guest names", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Ana");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(yourTicket("Asado")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Guest 1 first name")).toHaveValue("Ana");
  });

  it("covers R5: a server-rejected order marks the offending rows, not a single banner", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Fix the highlighted guests",
        violations: [
          { rule: "email_invalid", message: "Server says this email is bad", personIndex: 1, field: "email" },
        ],
      }),
    });
    renderForm([asado]);
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Ana");
    await user.type(screen.getByLabelText("Guest 1 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    expect(await screen.findByText("Server says this email is bad")).toBeInTheDocument();
  });

  it("covers R5/KD5: an order-scoped violation (personIndex null) renders above the rows with no row highlighted", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Invite limit reached",
        violations: [
          { rule: "too_many_people", message: "This invite allows fewer guests than that", personIndex: null, field: null },
        ],
      }),
    });
    renderForm([asado]);
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 first name"), "Ana");
    await user.type(screen.getByLabelText("Guest 1 last name"), "Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    expect(await screen.findByText("This invite allows fewer guests than that")).toBeInTheDocument();
    // Rendered exactly once — as the summary banner, not duplicated against the guest row.
    expect(screen.getAllByText("This invite allows fewer guests than that")).toHaveLength(1);
    expect(screen.queryByText(/Each person needs/)).not.toBeInTheDocument();
  });
});

describe("U7 — offer mode", () => {
  it("keeps Continue disabled at zero selection, and enables it once the buyer picks within the redeemable quantity", async () => {
    const user = userEvent.setup();
    const offer: OfferMode = { token: "tok-1", redeemableQuantity: 2, email: "entry@x.ch" };
    renderForm([asado, veg], { offer });
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await user.click(yourTicket("Asado"));
    expect(cont).toBeEnabled();
  });

  // The redeemable quantity still bounds the ORDER; with one ticket per head it bounds
  // how many people fit on it, and swapping the buyer's own type stays free.
  it("caps the order at the redeemable quantity while still allowing a swap", async () => {
    const user = userEvent.setup();
    const offer: OfferMode = { token: "tok-1", redeemableQuantity: 1, email: "entry@x.ch" };
    renderForm([asado, veg], { offer });
    await user.click(yourTicket("Asado"));
    expect(yourTicket("Veg")).toBeEnabled();
    await user.click(yourTicket("Veg"));
    expect(yourTicket("Veg")).toBeChecked();
    expect(yourTicket("Asado")).not.toBeChecked();
    expect(screen.getByText(/Maximum 1 tickets/i)).toBeInTheDocument();
  });

  it("renders the buyer's email input read-only and pinned to the entry's address", () => {
    const offer: OfferMode = { token: "tok-1", redeemableQuantity: 1, email: "pinned@x.ch" };
    renderForm([asado], { offer });
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    expect(emailInput).toHaveValue("pinned@x.ch");
    expect(emailInput).toHaveAttribute("readonly");
  });

  it("pre-fills the buyer's name from the entry and keeps it editable", async () => {
    const user = userEvent.setup();
    const offer: OfferMode = { token: "tok-1", redeemableQuantity: 1, email: "e@x.ch", name: "Jane Guest" };
    renderForm([asado], { offer });
    expect(screen.getByLabelText("First name")).toHaveValue("Jane");
    expect(screen.getByLabelText("Last name")).toHaveValue("Guest");
    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Janet");
    expect(screen.getByLabelText("First name")).toHaveValue("Janet");
  });

  it("pre-selects the requested ticket type on mount when it is still live", () => {
    const offer: OfferMode = { token: "tok-1", redeemableQuantity: 2, email: "e@x.ch", ticketTypeId: "a" };
    renderForm([asado, veg], { offer });
    expect(yourTicket("Asado")).toBeChecked();
    expect(yourTicket("Veg")).not.toBeChecked();
  });

  it("shows a replacement message and no pre-selection when the requested type is archived/retired", () => {
    const offer: OfferMode = { token: "tok-1", redeemableQuantity: 2, email: "e@x.ch", ticketTypeId: "gone" };
    renderForm([asado, veg], { offer });
    expect(screen.getByText(/no longer offered/i)).toBeInTheDocument();
    expect(yourTicket("Asado")).not.toBeChecked();
    expect(yourTicket("Veg")).not.toBeChecked();
  });

  it("shows offer-specific copy — no waitlist copy or CTA — on a 409 sold-out response in offer mode", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Not enough tickets remaining" }),
    });
    const offer: OfferMode = { token: "tok-xyz", redeemableQuantity: 1, email: "e@x.ch", ticketTypeId: "a" };
    renderForm([asado], { offer });
    await fillBuyer(user, "Jane", "Guest", "e@x.ch");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Book tickets/ }));
    expect(await screen.findByText(/those seats just went/i)).toBeInTheDocument();
    expect(screen.queryByText(/waitlist/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /check availability/i })).toHaveAttribute(
      "href",
      "/public/offers/tok-xyz"
    );
  });

  it("renders unchanged outside offer mode", () => {
    renderForm([asado, veg]);
    expect(screen.queryByText(/Pinned to your offer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/with this offer/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("readonly");
  });
});
