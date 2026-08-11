// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

import TicketManager, { type ManageTicket } from "@/components/public/TicketManager";

const ticket = (over: Partial<ManageTicket> = {}): ManageTicket => ({
  id: "t1",
  name: "Sophie Berger",
  email: "sophie.berger@example.com",
  typeId: "tt-1",
  typeTitle: "Clubhouse Dinner",
  checkedIn: false,
  cancellationStatus: null,
  credentialUrl: "https://example.test/c/abc",
  waiverSigned: false,
  ...over,
});

function renderManager(
  tickets: ManageTicket[],
  extra: { topupEndpoint?: string; buyableTypes?: { id: string; title: string; priceLabel: string }[] } = {}
) {
  return render(
    <TicketManager
      eventTitle="Summer Asado"
      eventDate="11 Jul 2026"
      eventLocation="Geneva"
      referenceCode="GPC-001"
      calendarUrl={null}
      tickets={tickets}
      fillEndpoint="/fill"
      convertEndpoint="/convert"
      cancelEndpoint="/cancel"
      waiverEndpoint="/waiver"
      convertTypes={[]}
      topupEndpoint={extra.topupEndpoint}
      buyableTypes={extra.buyableTypes}
    />
  );
}

const cardOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

describe("TicketManager — what a guest sees on a phone", () => {
  it("leads with the name and email, and shows the type as plain text", () => {
    renderManager([ticket()]);
    const card = cardOf("Sophie Berger");
    expect(within(card).getByText("sophie.berger@example.com")).toBeInTheDocument();
    expect(within(card).getByText("Clubhouse Dinner")).toBeInTheDocument();
  });

  // The old "This link" pill confused holders — it labelled which ticket's link they had
  // opened, which is not a thing a guest has any use for.
  it("does not label which ticket's link was opened", () => {
    renderManager([ticket(), ticket({ id: "t2", name: "Matthias Berger" })]);
    expect(screen.queryByText(/this link/i)).toBeNull();
  });

  it("numbers the tickets discreetly only when there is more than one", () => {
    renderManager([
      ticket(),
      ticket({ id: "t2", name: "Matthias Berger" }),
      ticket({ id: "t3", name: "Lena Berger" }),
    ]);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();

    cleanup();
    renderManager([ticket()]);
    expect(screen.queryByText(/of 1$/)).toBeNull();
  });

  // It belongs with the ticket it applies to — in the details column under the type, not
  // adrift below the QR where it reads as a card-level action.
  it("puts the waiver action in the same column as the ticket type", () => {
    renderManager([ticket()]);
    const column = within(cardOf("Sophie Berger")).getByText("Clubhouse Dinner")
      .parentElement as HTMLElement;
    expect(within(column).getByRole("button", { name: "Sign the waiver" })).toBeInTheDocument();
    // ...and the secondary row is NOT in that column.
    expect(within(column).queryByRole("button", { name: "Cancel ticket" })).toBeNull();
  });

  it("offers the waiver as the prominent action and cancel as the quiet one", () => {
    renderManager([ticket()]);
    const card = cardOf("Sophie Berger");

    const sign = within(card).getByRole("button", { name: "Sign the waiver" });
    const cancel = within(card).getByRole("button", { name: "Cancel ticket" });

    // Filled pill vs muted text — the two must not read as peers.
    expect(sign.className).toContain("bg-marine");
    expect(cancel.className).not.toContain("bg-marine");
    expect(cancel.className).toContain("text-marine/50");
  });

  // Edit and cancel share a line, but cancel is pushed to the far edge and carries no
  // emphasis — separated by distance and weight rather than by a row of its own.
  it("pushes cancel to the opposite end of the secondary row", () => {
    renderManager([ticket()]);
    const card = cardOf("Sophie Berger");
    const cancel = within(card).getByRole("button", { name: "Cancel ticket" });
    const edit = within(card).getByRole("button", { name: "Edit name / email" });

    const row = cancel.parentElement as HTMLElement;
    expect(row.className).toContain("justify-between");
    expect(row.className).toContain("border-t");
    // Cancel is the row's own child; edit sits in the grouped controls to its left.
    expect(row.contains(edit)).toBe(true);
    expect(edit.parentElement).not.toBe(row);
    expect(row.lastElementChild).toBe(cancel);
  });

  // Only the primary action is a pill. Edit sits with cancel as plain text so the eye lands
  // on the one thing worth doing before the night.
  it("keeps the waiver as the only pill on the card", () => {
    renderManager([ticket()]);
    const card = cardOf("Sophie Berger");
    expect(
      within(card).getByRole("button", { name: "Sign the waiver" }).className
    ).toContain("rounded-full");
    expect(
      within(card).getByRole("button", { name: "Edit name / email" }).className
    ).not.toContain("rounded-full");
  });

  it("replaces the waiver action with a signed pill once accepted", () => {
    renderManager([ticket({ waiverSigned: true })]);
    const card = cardOf("Sophie Berger");
    expect(within(card).getByText("Waiver signed")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Sign the waiver" })).toBeNull();
  });

  it("offers nothing to do on a cancelled ticket", () => {
    renderManager([ticket({ cancellationStatus: "requested" })]);
    const card = cardOf("Sophie Berger");
    expect(within(card).getByText("Cancelled")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Sign the waiver" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Cancel ticket" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Edit name / email" })).toBeNull();
  });

  it("signs one ticket without touching its household siblings", async () => {
    const user = userEvent.setup();
    renderManager([ticket(), ticket({ id: "t2", name: "Matthias Berger" })]);

    const card = cardOf("Matthias Berger");
    await user.click(within(card).getByRole("button", { name: "Sign the waiver" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.ticketId).toBe("t2");

    // Sophie's ticket still offers its own — one acceptance never covers the household.
    expect(
      within(cardOf("Sophie Berger")).getByRole("button", { name: "Sign the waiver" })
    ).toBeInTheDocument();
  });

  // A 200 that is not this route's JSON — a captive portal's login page, a proxy error page, a
  // service worker's cached reply — is what a guest on venue wifi actually hits. res.ok alone
  // cannot tell it from a real acceptance, and claiming success here is unrecoverable in the
  // UI: the pill replaces the Sign button, so there is no way back to it without a reload.
  it.each([
    ["a body that is not JSON", { ok: true, json: async () => { throw new SyntaxError("no"); } }],
    ["a 200 whose body says ok:false", { ok: true, json: async () => ({ ok: false, error: "Nope" }) }],
  ])("does not claim a signature on %s", async (_label, response) => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);
    renderManager([ticket()]);

    await user.click(within(cardOf("Sophie Berger")).getByRole("button", { name: "Sign the waiver" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    // The modal stays open with the failure shown, so the guest can retry rather than walking
    // away believing they are done.
    expect(await within(dialog).findByText(/could not record your acceptance|nope/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    // Still offered, and no "Waiver signed" pill.
    const card = cardOf("Sophie Berger");
    expect(within(card).getByRole("button", { name: "Sign the waiver" })).toBeInTheDocument();
    expect(within(card).queryByText("Waiver signed")).toBeNull();
    errorSpy.mockRestore();
  });

  // Changing the address hands the seat to someone else: the ticket leaves this household and
  // vanishes from the page, the new address gets its own link and QR, and any signed waiver is
  // cleared. None of it is undoable from here, so it is confirmed before the tap, not after.
  it("confirms before handing a ticket to a different email, and does not save on the first tap", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    renderManager([ticket({ waiverSigned: true })]);

    await user.click(within(cardOf("Sophie Berger")).getByRole("button", { name: "Edit name / email" }));
    const emailField = screen.getByPlaceholderText("Email");
    await user.clear(emailField);
    await user.type(emailField, "someone.else@example.com");

    fetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Nothing sent yet — the tap only surfaced the consequences.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/gives the ticket to someone else/i)).toBeInTheDocument();
    expect(screen.getByText(/disappears from this page/i)).toBeInTheDocument();
    // The signed waiver is called out, since it is cleared.
    expect(screen.getByText(/waiver signed for Sophie Berger is cleared/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, give it to them" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      email: "someone.else@example.com",
    });
  });

  // A typo fix is not a handover, and must not be gated behind a scary confirmation.
  it("saves a name-only edit without confirming", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    renderManager([ticket()]);

    await user.click(within(cardOf("Sophie Berger")).getByRole("button", { name: "Edit name / email" }));
    const nameField = screen.getByPlaceholderText("Full name");
    await user.clear(nameField);
    await user.type(nameField, "Sophie Berger-Roux");

    fetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByText(/gives the ticket to someone else/i)).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      name: "Sophie Berger-Roux",
    });
  });

  // A confirmation belongs to the address that was on screen when it was given. Otherwise
  // confirming for one address and typing another would save the second one unconfirmed.
  it("re-asks when the address changes again after confirming", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    renderManager([ticket()]);

    await user.click(within(cardOf("Sophie Berger")).getByRole("button", { name: "Edit name / email" }));
    const emailField = screen.getByPlaceholderText("Email");
    await user.clear(emailField);
    await user.type(emailField, "first@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/gives the ticket to someone else/i)).toBeInTheDocument();

    await user.type(emailField, "x");
    fetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The save can succeed while the delivery fails. Once the address changes the ticket leaves
  // this page, so if we do not say it here nobody ever finds out the guest has no QR.
  it("warns when the ticket was saved but the QR could not be emailed", async () => {
    const user = userEvent.setup();
    renderManager([ticket()]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, emailChanged: true, qrEmailSent: false }),
    });

    await user.click(within(cardOf("Sophie Berger")).getByRole("button", { name: "Edit name / email" }));
    const emailField = screen.getByPlaceholderText("Email");
    await user.clear(emailField);
    await user.type(emailField, "unreachable@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Yes, give it to them" }));

    // Scoped to the error line — the page also carries a standing "no QR code, no bracelet"
    // notice, so a bare /no QR code/ matches two different things.
    const warning = await screen.findByText(/could not email unreachable@example\.com/i);
    expect(warning).toHaveTextContent(/They have no QR code/i);
    expect(warning).toHaveTextContent(/save again to retry/i);
    // The form stays open so the retry is right there.
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
  });

  it("shows the waiver pill and drops the control once genuinely signed", async () => {
    const user = userEvent.setup();
    renderManager([ticket()]);
    const card = cardOf("Sophie Berger");
    await user.click(within(card).getByRole("button", { name: "Sign the waiver" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    expect(within(cardOf("Sophie Berger")).getByText("Waiver signed")).toBeInTheDocument();
    expect(within(cardOf("Sophie Berger")).queryByRole("button", { name: "Sign the waiver" })).toBeNull();
  });
});

// U2: any holder can buy more seats onto the booking from their own manage page.
describe("TicketManager — buy more tickets (U2)", () => {
  const types = [{ id: "tt-1", title: "Clubhouse Dinner", priceLabel: "CHF 40" }];

  it("does not render when there is nothing to buy", () => {
    renderManager([ticket()]);
    expect(screen.queryByRole("button", { name: /Buy more tickets/i })).toBeNull();
  });

  it("does not render when a topupEndpoint is given but no buyable types are", () => {
    renderManager([ticket()], { topupEndpoint: "/topup", buyableTypes: [] });
    expect(screen.queryByRole("button", { name: /Buy more tickets/i })).toBeNull();
  });

  // R3: present, but secondary — a closed floating action below the tickets, not competing
  // with them.
  it("renders as a closed floating action below the tickets themselves", () => {
    renderManager([ticket()], { topupEndpoint: "/topup", buyableTypes: types });
    const toggle = screen.getByRole("button", { name: /Buy more tickets/i });
    expect(toggle).toBeInTheDocument();
    // Nothing else from the panel (quantity controls, guest fields) is visible until opened.
    expect(screen.queryByLabelText(/Add one Clubhouse Dinner/i)).toBeNull();
    // It sits after the ticket list in the document, not above it.
    const ticketsList = cardOf("Sophie Berger").closest("ul") as HTMLElement;
    expect(
      ticketsList.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // R20: never call this a "top-up" in guest-facing copy, even though it posts to the
  // top-up route under the hood.
  it("never uses the word 'top-up' anywhere in its copy", async () => {
    const user = userEvent.setup();
    renderManager([ticket()], { topupEndpoint: "/topup", buyableTypes: types });
    await user.click(screen.getByRole("button", { name: /Buy more tickets/i }));
    expect(document.body.textContent).not.toMatch(/top[\s-]?up/i);
  });

  it("requires a name and email for every seat before it can be bought", async () => {
    const user = userEvent.setup();
    renderManager([ticket()], { topupEndpoint: "/topup", buyableTypes: types });
    await user.click(screen.getByRole("button", { name: /Buy more tickets/i }));
    await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));

    const buyButton = screen.getByRole("button", { name: /Buy 1 ticket/i });
    expect(buyButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText("First and last name"), "New Guest");
    expect(buyButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Email"), "new.guest@example.com");
    expect(buyButton).toBeEnabled();
  });

  it("posts the selected items and named guests, then follows the checkout redirect", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, checkoutUrl: "https://stripe.test/session" }),
    });
    const originalLocation = window.location;
    // @ts-expect-error jsdom navigation stub
    delete window.location;
    // @ts-expect-error jsdom navigation stub
    window.location = { ...originalLocation, href: "" };

    renderManager([ticket()], { topupEndpoint: "/topup", buyableTypes: types });
    await user.click(screen.getByRole("button", { name: /Buy more tickets/i }));
    await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));
    await user.type(screen.getByPlaceholderText("First and last name"), "New Guest");
    await user.type(screen.getByPlaceholderText("Email"), "new.guest@example.com");
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/topup",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      items: [{ ticketTypeId: "tt-1", quantity: 1 }],
      attendees: [{ ticket_type_id: "tt-1", name: "New Guest", email: "new.guest@example.com" }],
    });
    expect(window.location.href).toBe("https://stripe.test/session");

    // @ts-expect-error jsdom navigation stub
    window.location = originalLocation;
  });
});
