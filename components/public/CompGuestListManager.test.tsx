// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

import CompGuestListManager, { type CompGuestTicket } from "@/components/public/CompGuestListManager";

const guest = (over: Partial<CompGuestTicket> = {}): CompGuestTicket => ({
  id: "t1",
  name: "",
  email: "",
  phone: "",
  typeTitle: "Comp Guest",
  status: "issued",
  checkedIn: false,
  credentialUrl: "https://example.test/c/abc",
  isLead: false,
  ...over,
});

const sponsor = (over: Partial<CompGuestTicket> = {}): CompGuestTicket => ({
  id: "t-sponsor",
  name: "Sponsor Bauman",
  email: "sponsor@example.com",
  phone: "",
  typeTitle: "Sponsor Seat",
  status: "claimed",
  checkedIn: false,
  credentialUrl: "https://example.test/c/sponsor",
  isLead: true,
  ...over,
});

function renderManager(
  tickets: CompGuestTicket[],
  extra: {
    topupEndpoint?: string;
    buyableTypes?: { id: string; title: string; priceLabel: string }[];
  } = {}
) {
  return render(
    <CompGuestListManager
      eventTitle="Bohemian Chic Polo Party"
      eventDate="Saturday 12 September"
      referenceCode="REF123"
      quantity={tickets.length}
      tickets={tickets}
      fillEndpoint="/api/public/bookings/tok/fill"
      {...extra}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ticketId: "t1", name: "Guest Of Club", emailChanged: false, qrEmailSent: true }),
    })
  );
});

describe("CompGuestListManager — comp guest QR grid and naming", () => {
  it("renders each guest's QR and lets the sponsor add a name and email", async () => {
    const user = userEvent.setup();
    renderManager([sponsor(), guest()]);
    // Both tickets render, sponsor's own seat and the comp guest's.
    expect(screen.getByText("Sponsor Bauman")).toBeInTheDocument();
    expect(screen.getByText(/Unnamed/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add name" }));
    await user.type(screen.getByPlaceholderText("Guest name"), "New Guest");
    await user.type(screen.getByPlaceholderText("Email (for their QR code)"), "guest@example.com");
    await user.click(screen.getByRole("button", { name: /Save & send QR/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/public/bookings/tok/fill",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows the sponsor's own seat as read-only, never editable", () => {
    renderManager([sponsor()]);
    expect(screen.getByText("Your ticket")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add name|Edit name/i })).toBeNull();
  });
});

describe("CompGuestListManager — buy more paid seats (KTD2)", () => {
  const types = [{ id: "tt-1", title: "Sponsor Add-on", priceLabel: "CHF 50" }];

  it("does not render when nothing is buyable", () => {
    renderManager([sponsor()]);
    expect(screen.queryByRole("button", { name: /Buy more tickets/i })).toBeNull();
  });

  it("renders the buy-more panel as a closed floating action when buyable types exist", () => {
    renderManager([sponsor()], { topupEndpoint: "/api/public/bookings/tok/topup", buyableTypes: types });
    const toggle = screen.getByRole("button", { name: /Buy more tickets/i });
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add guest/i })).toBeNull();
  });

  it("lets the sponsor open the panel and add a guest row", async () => {
    const user = userEvent.setup();
    renderManager([sponsor()], { topupEndpoint: "/api/public/bookings/tok/topup", buyableTypes: types });
    await user.click(screen.getByRole("button", { name: /Buy more tickets/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    expect(screen.getByLabelText("Guest 1 email")).toBeInTheDocument();
    expect(screen.getByLabelText("Guest 1 Sponsor Add-on ticket")).toBeInTheDocument();
  });
});
