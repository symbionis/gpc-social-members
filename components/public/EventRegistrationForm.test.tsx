// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/components/common/PhoneInput", () => ({
  default: () => <input aria-label="Phone" />,
}));

import EventRegistrationForm, { type TicketTypeOption } from "@/components/public/EventRegistrationForm";

const asado: TicketTypeOption = { id: "a", title: "Asado", price: 80 };
const veg: TicketTypeOption = { id: "v", title: "Veg", price: 40 };
const kids: TicketTypeOption = { id: "k", title: "Kids", price: 0 };
const soon: TicketTypeOption = { id: "n", title: "Soon", price: null };

function renderForm(ticketTypes: TicketTypeOption[], props: Partial<React.ComponentProps<typeof EventRegistrationForm>> = {}) {
  return render(<EventRegistrationForm eventId="evt-1" ticketTypes={ticketTypes} {...props} />);
}

const addBtn = (title: string) => screen.getByRole("button", { name: `Add one ${title} ticket` });

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "stop" }) });
});

describe("U1 — unified ticket list + step 1 gating", () => {
  it("renders one stepper per selectable type and no 'Your ticket' dropdown", () => {
    renderForm([asado, veg, kids]);
    expect(screen.getByRole("button", { name: "Add one Asado ticket" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add one Veg ticket" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add one Kids ticket" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows a null-priced type as 'Not open yet' with no stepper", () => {
    renderForm([asado, soon]);
    expect(screen.getByText("Not open yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add one Soon ticket" })).not.toBeInTheDocument();
  });

  it("reflects the party total from quantities only (no phantom lead +1)", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    // The Total value (heading), disambiguated from the row's own price label.
    expect(screen.getByText("CHF 80.00", { selector: "span.font-heading" })).toBeInTheDocument();
  });

  it("covers R6: keeps Continue disabled until any ticket is selected — a former child type is no longer special-cased", async () => {
    const user = userEvent.setup();
    renderForm([asado, kids]);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await user.click(addBtn("Kids")); // a former child type, alone, is now sufficient
    expect(cont).toBeEnabled();
  });

  it("caps the party and disables + at the cap", async () => {
    const user = userEvent.setup();
    renderForm([asado], { maxQuantity: 2 });
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    expect(addBtn("Asado")).toBeDisabled();
    expect(screen.getByText(/Maximum 2 tickets/i)).toBeInTheDocument();
  });
});

describe("ticket-type description display", () => {
  it("renders a type's description beside its title", () => {
    renderForm([{ ...asado, description: "Includes welcome drink + seated dinner" }]);
    expect(screen.getByText("Includes welcome drink + seated dinner")).toBeInTheDocument();
  });

  it("renders no description element when a type has none", () => {
    // asado carries no description; null/undefined must produce no stray node.
    renderForm([{ ...veg, description: null }]);
    expect(screen.queryByText(/includes/i)).not.toBeInTheDocument();
    // The type still renders normally.
    expect(screen.getByRole("button", { name: "Add one Veg ticket" })).toBeInTheDocument();
  });
});

describe("U2 — attendee naming step", () => {
  async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("First name"), "Frank");
    await user.type(screen.getByLabelText("Last name"), "Sykes");
    await user.type(screen.getByLabelText("Email"), "frank@x.ch");
    await user.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("single adult type: no meal picker, one guest row per extra ticket", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado")); // 2 total → lead + 1 guest
    await goToStep2(user);
    expect(screen.getByText("Who's coming?")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument(); // no meal picker
    expect(screen.getByLabelText(/Guest 1 first name — Asado/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Guest 2 name/)).not.toBeInTheDocument();
  });

  it("two adult types: shows the 'which is yours' picker and blocks submit until chosen", async () => {
    const user = userEvent.setup();
    renderForm([asado, veg]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Veg"));
    await goToStep2(user);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Reserve your spot/ })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Asado/ }));
    expect(screen.getByRole("button", { name: /Reserve your spot/ })).toBeEnabled();
  });

  it("covers AE3: a former child-type guest row shows first, last, and email like any other (R8)", async () => {
    const user = userEvent.setup();
    renderForm([asado, kids]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Kids"));
    await goToStep2(user);
    // 2 selected types (a former child type is no longer excluded from the "which is
    // yours" split, R6) — pick Asado as the buyer's own before the Kids slot resolves
    // to a guest row.
    await user.click(screen.getByRole("radio", { name: /Asado/ }));
    const kidRow = screen.getByText(/Guest 1 · Kids/).closest("div")!;
    expect(within(kidRow).getByLabelText(/Guest 1 first name — Kids/)).toBeInTheDocument();
    expect(within(kidRow).getByLabelText(/Guest 1 last name — Kids/)).toBeInTheDocument();
    expect(within(kidRow).getByLabelText(/Guest 1 email — Kids/)).toBeInTheDocument();
  });

  it("adult guest with a name but no email blocks submit with an inline error", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await goToStep2(user);
    await user.type(screen.getByLabelText(/Guest 1 first name — Asado/), "Ana");
    await user.type(screen.getByLabelText(/Guest 1 last name — Asado/), "Adult");
    await user.click(screen.getByRole("button", { name: /Reserve your spot/ }));
    expect(screen.getByText(/valid email for this guest/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("covers R1: a blank guest row blocks submit with an inline error, no request sent", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /Reserve your spot/ }));
    expect(screen.getByText(/first and last name/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits every named guest, tagged with its ticket type", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado")); // lead + 2 guests
    await goToStep2(user);
    await user.type(screen.getByLabelText(/Guest 1 first name — Asado/), "Ana");
    await user.type(screen.getByLabelText(/Guest 1 last name — Asado/), "Adult");
    await user.type(screen.getByLabelText(/Guest 1 email — Asado/), "ana@x.ch");
    await user.type(screen.getByLabelText(/Guest 2 first name — Asado/), "Ben");
    await user.type(screen.getByLabelText(/Guest 2 last name — Asado/), "Adult");
    await user.type(screen.getByLabelText(/Guest 2 email — Asado/), "ben@x.ch");
    await user.click(screen.getByRole("button", { name: /Reserve your spot/ }));
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.attendees).toEqual([
      { ticket_type_id: "a", name: "Ana Adult", email: "ana@x.ch" },
      { ticket_type_id: "a", name: "Ben Adult", email: "ben@x.ch" },
    ]);
  });

  it("Back preserves quantities and typed guest names", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await goToStep2(user);
    await user.type(screen.getByLabelText(/Guest 1 first name — Asado/), "Ana");
    await user.type(screen.getByLabelText(/Guest 1 last name — Asado/), "Adult");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Asado quantity")).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText(/Guest 1 first name — Asado/)).toHaveValue("Ana");
  });
});
