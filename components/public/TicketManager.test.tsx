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

function renderManager(tickets: ManageTicket[]) {
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
});
