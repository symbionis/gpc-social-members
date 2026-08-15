// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config — unmount between tests ourselves.
afterEach(cleanup);

import BuyMorePanel from "@/components/public/BuyMorePanel";

const types = [
  { id: "a", title: "Asado", priceLabel: "CHF 80.00" },
  { id: "v", title: "Veg", priceLabel: "CHF 40.00" },
];

function renderOpenPanel(props: Partial<React.ComponentProps<typeof BuyMorePanel>> = {}) {
  const utils = render(<BuyMorePanel endpoint="/api/topup" types={types} {...props} />);
  return utils;
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /buy more tickets/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "stop" }) });
});

describe("panel open/close", () => {
  it("starts closed and opens on click", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    expect(screen.queryByRole("button", { name: /add guest/i })).not.toBeInTheDocument();
    await openPanel(user);
    expect(screen.getByRole("button", { name: /add guest/i })).toBeInTheDocument();
  });
});

describe("repeatable guest rows (R20) — same shape as checkout", () => {
  it("starts with zero guest rows; Add guest appends a row with name, email, and ticket-type checkboxes", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    expect(screen.queryByLabelText(/Guest 1 name/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    expect(screen.getByLabelText("Guest 1 name")).toBeInTheDocument();
    expect(screen.getByLabelText("Guest 1 email")).toBeInTheDocument();
    expect(screen.getByLabelText("Guest 1 Asado ticket")).toBeInTheDocument();
    expect(screen.getByLabelText("Guest 1 Veg ticket")).toBeInTheDocument();
  });

  it("Remove takes a guest row back out", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: "Remove guest 1" }));
    expect(screen.queryByLabelText(/Guest 1 name/)).not.toBeInTheDocument();
  });

  it("a person taking two ticket types is one row with two checkboxes selected, not two rows", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, redirectUrl: "/x" }) });
    // jsdom doesn't implement navigation; swallow it.
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByLabelText("Guest 1 Veg ticket"));
    expect(screen.queryByLabelText(/Guest 2/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Buy 2 tickets/i }));
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.people).toEqual([{ name: "Ana Adult", email: "ana@x.ch", ticketTypeIds: ["a", "v"] }]);
  });
});

describe("R18/KD5 — buy-more gets checkout's naming rigor", () => {
  it("refuses a guest with no email (today's non-empty-only check is replaced by validateOrder)", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    expect(screen.getByText("Each person needs an email")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a guest with a malformed email", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "not-an-email");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    expect(screen.getByText("Each person needs a valid email")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a name with no surname (R8)", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    expect(screen.getByText("Each person needs a first and last name")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("covers R5/KD5: three invalid guest rows all show errors simultaneously", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 2 name"), "Ben Adult");
    await user.type(screen.getByLabelText("Guest 2 email"), "ben@x.ch");
    await user.type(screen.getByLabelText("Guest 3 name"), "Cara Adult");
    await user.type(screen.getByLabelText("Guest 3 email"), "cara@x.ch");
    await user.click(screen.getByLabelText("Guest 3 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Each person needs a name")).toBeInTheDocument(); // guest 1
    expect(screen.getAllByText("Each person needs at least one ticket")).toHaveLength(2); // guests 1 & 2
  });

  it("covers R4: a shared email across two guests is accepted", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "shared@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.type(screen.getByLabelText("Guest 2 name"), "Ben Adult");
    await user.type(screen.getByLabelText("Guest 2 email"), "shared@x.ch");
    await user.click(screen.getByLabelText("Guest 2 Veg ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 2 tickets/i }));
    expect(global.fetch).toHaveBeenCalled();
  });

  it("blocks the same person named twice on the same ticket type", async () => {
    const user = userEvent.setup();
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.type(screen.getByLabelText("Guest 2 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 2 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 2 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 2 tickets/i }));
    expect(screen.getByText(/already holds this ticket type/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("server-side rejection", () => {
  it("covers R5: a server-rejected order marks the offending row, not a single banner", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Fix the guest",
        violations: [
          { rule: "email_invalid", message: "Server says this email is bad", personIndex: 0, field: "email" },
        ],
      }),
    });
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    expect(await screen.findByText("Server says this email is bad")).toBeInTheDocument();
  });

  it("covers R5/KD5: an order-scoped violation (personIndex null) renders above the rows, not against any one of them", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Too many",
        violations: [
          { rule: "too_many_tickets", message: "Not enough seats remain for this event", personIndex: null, field: null },
        ],
      }),
    });
    renderOpenPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    expect(await screen.findByText("Not enough seats remain for this event")).toBeInTheDocument();
    expect(screen.queryByText(/Each person needs/)).not.toBeInTheDocument();
  });
});

describe("already-held types (scenario 7)", () => {
  it("marks a type the holder already holds as held, rather than erroring when selected", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderOpenPanel({ heldTypeIds: ["a"] });
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    expect(screen.getByText(/you already have this/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Guest 1 name"), "Ana Adult");
    await user.type(screen.getByLabelText("Guest 1 email"), "ana@x.ch");
    await user.click(screen.getByLabelText("Guest 1 Asado ticket"));
    await user.click(screen.getByRole("button", { name: /Buy 1 ticket/i }));
    // No validation error for picking an already-held type — it's informational only.
    expect(screen.queryByText(/already holds this ticket type/i)).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalled();
  });
});
