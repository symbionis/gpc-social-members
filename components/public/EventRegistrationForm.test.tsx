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

const asado: TicketTypeOption = { id: "a", title: "Asado", price: 80, is_child: false };
const veg: TicketTypeOption = { id: "v", title: "Veg", price: 40, is_child: false };
const kids: TicketTypeOption = { id: "k", title: "Kids", price: 0, is_child: true };
const soon: TicketTypeOption = { id: "n", title: "Soon", price: null, is_child: false };

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

  it("keeps Continue disabled until an adult ticket is selected", async () => {
    const user = userEvent.setup();
    renderForm([asado, kids]);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await user.click(addBtn("Kids")); // child only
    expect(cont).toBeDisabled();
    expect(screen.getByText(/at least one adult ticket/i)).toBeInTheDocument();
    await user.click(addBtn("Asado"));
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

describe("U2 — attendee naming step", () => {
  async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Full name"), "Frank");
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
    expect(screen.getByLabelText(/Guest 1 name — Asado/)).toBeInTheDocument();
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

  it("child guest row has a name field but no email field", async () => {
    const user = userEvent.setup();
    renderForm([asado, kids]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Kids"));
    await goToStep2(user);
    const kidRow = screen.getByText(/Guest 1 · Kids/).closest("div")!;
    expect(within(kidRow).getByLabelText(/Guest 1 name — Kids/)).toBeInTheDocument();
    expect(within(kidRow).queryByLabelText(/Guest 1 email/)).not.toBeInTheDocument();
  });

  it("adult guest with a name but no email blocks submit with an inline error", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await goToStep2(user);
    await user.type(screen.getByLabelText(/Guest 1 name — Asado/), "Ana");
    await user.click(screen.getByRole("button", { name: /Reserve your spot/ }));
    expect(screen.getByText(/valid email for this guest/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits with no attendees when all guest rows are blank", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /Reserve your spot/ }));
    expect(global.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.attendees).toBeUndefined();
    expect(body.leadTicketTypeId).toBe("a");
    expect(body.items).toEqual([{ ticket_type_id: "a", quantity: 2 }]);
  });

  it("submits only the named guest, tagged with its ticket type", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado")); // lead + 2 guests
    await goToStep2(user);
    await user.type(screen.getByLabelText(/Guest 1 name — Asado/), "Ana");
    await user.type(screen.getByLabelText(/Guest 1 email — Asado/), "ana@x.ch");
    // Guest 2 left blank.
    await user.click(screen.getByRole("button", { name: /Reserve your spot/ }));
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.attendees).toEqual([{ ticket_type_id: "a", name: "Ana", email: "ana@x.ch" }]);
  });

  it("Back preserves quantities and typed guest names", async () => {
    const user = userEvent.setup();
    renderForm([asado]);
    await user.click(addBtn("Asado"));
    await user.click(addBtn("Asado"));
    await goToStep2(user);
    await user.type(screen.getByLabelText(/Guest 1 name — Asado/), "Ana");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Asado quantity")).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText(/Guest 1 name — Asado/)).toHaveValue("Ana");
  });
});
