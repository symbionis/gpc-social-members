// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import CancellationsPanel, { type CancellationRow } from "@/components/admin/CancellationsPanel";

let seq = 0;
function row(over: Partial<CancellationRow> = {}): CancellationRow {
  seq += 1;
  return {
    ticketId: `t-${seq}`,
    name: "Ben Adult",
    email: "ben@x.ch",
    ticketTypeTitle: "Standard",
    referenceCode: "EV-ABC123",
    payerName: "Ana Lead",
    payerEmail: "ana@x.ch",
    requestedAt: `2026-07-0${seq}T10:00:00Z`,
    status: "requested",
    refundValueChf: 80,
    refundedChf: null,
    refundedAt: null,
    stripeRefundId: null,
    paymentIntentIds: ["pi_main"],
    ...over,
  };
}

function renderPanel(rows: CancellationRow[]) {
  return render(<CancellationsPanel rows={rows} eventId="evt-1" stripeTestMode={false} />);
}

beforeEach(() => {
  seq = 0;
  vi.clearAllMocks();
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true, refundedChf: 80 }) });
});

describe("CancellationsPanel", () => {
  it("separates what is owed from what has been refunded", () => {
    renderPanel([
      row({ referenceCode: "EV-A", refundValueChf: 80 }),
      row({ referenceCode: "EV-B", refundValueChf: 40 }),
      row({
        referenceCode: "EV-C",
        status: "refunded",
        refundedChf: 200,
        refundedAt: "2026-07-09T09:00:00Z",
      }),
    ]);
    // The owed figure is the club's open liability — money finance still counts as revenue.
    expect(screen.getAllByText("CHF 120.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CHF 200.00").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("cancellation-row")).toHaveLength(3);
  });

  it("collapses one booking's seats into a single refund, not one per seat", () => {
    // Charlotte's real case: ONE Stripe refund of CHF 240 covering three seats. Listing them
    // separately repeated her name, her reference and that single refund id three times, and
    // read as three refunds.
    renderPanel([
      row({ name: "Charlotte", refundedChf: 80, status: "refunded", stripeRefundId: "re_1" }),
      row({ name: "", refundedChf: 80, status: "refunded", stripeRefundId: "re_1" }),
      row({ name: "", refundedChf: 80, status: "refunded", stripeRefundId: "re_1" }),
    ]);
    expect(screen.getAllByTestId("cancellation-booking")).toHaveLength(1);
    expect(screen.getAllByTestId("cancellation-row")).toHaveLength(3);
    // Subtotal for the booking, and the refund id stated once rather than three times.
    const card = screen.getByTestId("cancellation-booking");
    expect(within(card).getByText("CHF 240.00")).toBeInTheDocument();
    expect(within(card).getAllByText("re_1")).toHaveLength(1);
    expect(within(card).getByText("3 seats")).toBeInTheDocument();
  });

  it("keeps separate bookings apart even when they share a payer", () => {
    renderPanel([
      row({ referenceCode: "EV-A", refundValueChf: 80 }),
      row({ referenceCode: "EV-B", refundValueChf: 80 }),
    ]);
    expect(screen.getAllByTestId("cancellation-booking")).toHaveLength(2);
  });

  it("names the amount and the payer before moving money", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel([row({ ticketId: "t-x", refundValueChf: 80, payerName: "Ana Lead" })]);

    await user.click(screen.getByRole("button", { name: "Refund CHF 80.00" }));
    // This click sends real money, so the confirm has to say how much and to whom.
    expect(confirm.mock.calls[0][0]).toMatch(/CHF 80\.00/);
    expect(confirm.mock.calls[0][0]).toMatch(/Ana Lead/);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/events/evt-1/tickets/t-x/refund");
  });

  it("does nothing when the admin cancels the confirm", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel([row()]);
    await user.click(screen.getByRole("button", { name: "Refund CHF 80.00" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports the server's amount, not the one the row was rendered with", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // A stale tab: the seat is shown at 80 but the server refunded 50.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, refundedChf: 50 }),
    });
    renderPanel([row({ refundValueChf: 80 })]);
    await user.click(screen.getByRole("button", { name: "Refund CHF 80.00" }));
    expect(await screen.findByText(/Refunded CHF 50\.00/)).toBeInTheDocument();
  });

  it("says the record caught up rather than claiming a fresh refund", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, refundedChf: 80, reconciled: true }),
    });
    renderPanel([row()]);
    await user.click(screen.getByRole("button", { name: "Refund CHF 80.00" }));
    expect(await screen.findByText(/already refunded in Stripe/)).toBeInTheDocument();
  });

  it("surfaces a refusal instead of reporting success", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This booking only has CHF 20.00 left to refund" }),
    });
    renderPanel([row()]);
    await user.click(screen.getByRole("button", { name: "Refund CHF 80.00" }));
    expect(await screen.findByText(/only has CHF 20\.00 left/)).toBeInTheDocument();
  });

  it("offers to close, not refund, a seat that cost nothing", () => {
    renderPanel([row({ refundValueChf: 0 })]);
    // "Refund CHF 0.00" would read as a bug.
    expect(screen.queryByRole("button", { name: /^Refund/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows every charge the money can come back from", () => {
    // A topped-up booking has more than one. The admin should see that before clicking.
    renderPanel([row({ paymentIntentIds: ["pi_main", "pi_topup"] })]);
    const card = screen.getByTestId("cancellation-booking");
    expect(within(card).getByRole("link", { name: /Payment/ })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/payments/pi_main"
    );
    expect(within(card).getByRole("link", { name: /Top-up 1/ })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/payments/pi_topup"
    );
  });

  it("flags a booking with no payment on record", () => {
    renderPanel([row({ paymentIntentIds: [] })]);
    expect(screen.getByText("No Stripe payment on record")).toBeInTheDocument();
  });

  it("shows a settled row's recorded amount and no action", () => {
    renderPanel([
      row({ status: "refunded", refundedChf: 80, refundedAt: "2026-07-09T09:00:00Z" }),
    ]);
    expect(screen.queryByRole("button", { name: /Refund/ })).toBeNull();
    const card = screen.getByTestId("cancellation-row");
    expect(within(card).getByText(/CHF 80\.00/)).toBeInTheDocument();
  });

  it("totals the section so the headline figure ties to the rows", () => {
    renderPanel([
      row({ referenceCode: "EV-A", status: "refunded", refundedChf: 80 }),
      row({ referenceCode: "EV-B", status: "refunded", refundedChf: 40 }),
    ]);
    // Reading "CHF 560" with no way to see what made it up was the complaint.
    expect(screen.getByText(/2 seats · CHF 120\.00/)).toBeInTheDocument();
  });

  it("admits when a settled row has no recorded amount", () => {
    // Refunded before refund accounting existed. Finance derives a value for it, but the panel
    // must not invent one here.
    renderPanel([row({ status: "refunded", refundedChf: null })]);
    expect(screen.getByText(/amount not recorded/)).toBeInTheDocument();
  });

  it("states the empty case rather than rendering empty sections", () => {
    renderPanel([]);
    expect(screen.getByText("No cancellations for this event.")).toBeInTheDocument();
  });
});
