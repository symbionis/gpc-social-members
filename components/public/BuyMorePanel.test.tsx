// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

import BuyMorePanel from "@/components/public/BuyMorePanel";

const types = [
  { id: "tt-1", title: "Clubhouse Dinner", priceLabel: "CHF 40" },
  { id: "tt-2", title: "Brunch", priceLabel: "CHF 25" },
];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Buy more tickets/i }));
}

describe("BuyMorePanel — no allowance bound (member/public/comp bookings, R7/R11)", () => {
  it("has no ceiling beyond the panel's own +/- controls", async () => {
    const user = userEvent.setup();
    render(<BuyMorePanel endpoint="/topup" types={types} />);
    await openPanel(user);
    for (let i = 0; i < 15; i++) {
      await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));
    }
    expect(screen.getByRole("button", { name: "Add one Clubhouse Dinner" })).toBeEnabled();
    expect(screen.queryByText(/remaining on this booking/i)).toBeNull();
  });
});

describe("BuyMorePanel — remaining allowance bound (invite-class bookings, R5)", () => {
  it("disables + once the remaining allowance is reached", async () => {
    const user = userEvent.setup();
    render(<BuyMorePanel endpoint="/topup" types={types} remainingAllowance={2} bookingLimit={4} />);
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));
    await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));
    expect(screen.getByRole("button", { name: "Add one Clubhouse Dinner" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add one Brunch" })).toBeDisabled();
  });

  it("bounds the total across ticket types, not per type", async () => {
    const user = userEvent.setup();
    render(<BuyMorePanel endpoint="/topup" types={types} remainingAllowance={2} bookingLimit={4} />);
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));
    await user.click(screen.getByRole("button", { name: "Add one Brunch" }));
    expect(screen.getByRole("button", { name: "Add one Clubhouse Dinner" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add one Brunch" })).toBeDisabled();
  });

  it("at zero allowance, stays mounted showing the exhausted message instead of the pickers", async () => {
    const user = userEvent.setup();
    render(<BuyMorePanel endpoint="/topup" types={types} remainingAllowance={0} bookingLimit={4} />);
    expect(screen.getByRole("button", { name: /Buy more tickets/i })).toBeInTheDocument();
    await openPanel(user);
    expect(screen.getByText(/reached the maximum of 4 tickets for this booking/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add one Clubhouse Dinner" })).toBeNull();
  });

  it("never posts a basket exceeding the remaining allowance", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    render(<BuyMorePanel endpoint="/topup" types={types} remainingAllowance={1} bookingLimit={4} />);
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Add one Clubhouse Dinner" }));
    await user.type(screen.getByPlaceholderText("First and last name"), "New Guest");
    await user.type(screen.getByPlaceholderText("Email"), "new.guest@example.com");
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.items).toEqual([{ ticketTypeId: "tt-1", quantity: 1 }]);
  });
});
