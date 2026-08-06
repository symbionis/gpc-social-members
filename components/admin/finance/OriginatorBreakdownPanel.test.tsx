// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

import OriginatorBreakdownPanel from "@/components/admin/finance/OriginatorBreakdownPanel";
import type { OriginatorRevenue, OriginatorTxn } from "@/lib/admin/finance";

const ORIGINATORS: OriginatorRevenue[] = [
  {
    originatorId: "o1",
    name: "Sophie Dubois",
    net: 12400,
    convertedReferrals: 4,
    byMonth: [
      { monthKey: "2026-03", net: 4200, paidCount: 3 },
      { monthKey: "2026-04", net: 8200, paidCount: 2 },
    ],
  },
  {
    originatorId: "o2",
    name: "Marc Berger",
    net: 3900,
    convertedReferrals: 2,
    byMonth: [{ monthKey: "2026-04", net: 3900, paidCount: 1 }],
  },
  {
    originatorId: "o3",
    name: "Rene Sansref",
    net: 0,
    convertedReferrals: 1,
    byMonth: [],
  },
];

const TRANSACTIONS: OriginatorTxn[] = [
  {
    id: "pay-1",
    originatorId: "o1",
    monthKey: "2026-03",
    memberName: "A. Lindqvist",
    tierName: "Full",
    date: "2026-03-12",
    status: "paid",
    amountChf: 4200,
    stripeRef: { kind: "payment_intent", id: "pi_123" },
  },
  {
    id: "pay-2",
    originatorId: "o1",
    monthKey: "2026-04",
    memberName: "R. Moreau",
    tierName: "Social",
    date: "2026-04-28",
    status: "paid",
    amountChf: 8200,
    stripeRef: null,
  },
  {
    id: "pay-3",
    originatorId: "o2",
    monthKey: "2026-04",
    memberName: "K. Weber",
    tierName: "Full",
    date: "2026-04-05",
    status: "paid",
    amountChf: 3900,
    stripeRef: { kind: "checkout_session", id: "cs_456" },
  },
];

function renderPanel(
  over: Partial<React.ComponentProps<typeof OriginatorBreakdownPanel>> = {},
) {
  render(
    <OriginatorBreakdownPanel
      originators={ORIGINATORS}
      transactions={TRANSACTIONS}
      stripeTestMode={false}
      {...over}
    />,
  );
}

const originatorRow = (name: string | RegExp) => screen.getByRole("button", { name });

describe("OriginatorBreakdownPanel", () => {
  it("renders one collapsed row per originator, in the order given", () => {
    renderPanel();
    const rows = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(rows.map((b) => b.textContent)).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Sophie Dubois");
    expect(rows[1]).toHaveTextContent("Marc Berger");
    expect(rows[2]).toHaveTextContent("Rene Sansref");
    for (const row of rows) expect(row).toHaveAttribute("aria-expanded", "false");
    // Nothing below level 1 is on screen yet.
    expect(screen.queryByText("March 2026")).not.toBeInTheDocument();
  });

  it("shows each originator's net and converted-referral count", () => {
    renderPanel();
    const sophie = originatorRow(/Sophie Dubois/);
    expect(sophie).toHaveTextContent("4");
    expect(sophie).toHaveTextContent("CHF 12400");
  });

  it("expands an originator to its months and collapses it again", async () => {
    const user = userEvent.setup();
    renderPanel();
    const sophie = originatorRow(/Sophie Dubois/);

    await user.click(sophie);
    expect(sophie).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(screen.getByText("April 2026")).toBeInTheDocument();

    await user.click(sophie);
    expect(sophie).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("March 2026")).not.toBeInTheDocument();
  });

  it("labels months through formatMonth rather than a raw month key", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Sophie Dubois/));
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-03")).not.toBeInTheDocument();
  });

  it("keeps two originators open at once and clears both levels on Collapse all", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Sophie Dubois/));
    await user.click(originatorRow(/Marc Berger/));
    await user.click(originatorRow(/March 2026/));

    expect(originatorRow(/Sophie Dubois/)).toHaveAttribute("aria-expanded", "true");
    expect(originatorRow(/Marc Berger/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A. Lindqvist")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(originatorRow(/Sophie Dubois/)).toHaveAttribute("aria-expanded", "false");
    expect(originatorRow(/Marc Berger/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("A. Lindqvist")).not.toBeInTheDocument();
    // The control only exists while something is open.
    expect(screen.queryByRole("button", { name: "Collapse all" })).not.toBeInTheDocument();
  });

  it("reveals only the clicked originator-and-month's payments, under a header row", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Sophie Dubois/));
    await user.click(originatorRow(/April 2026/));

    // Sophie's April payment, not Marc's April payment.
    expect(screen.getByText("R. Moreau")).toBeInTheDocument();
    expect(screen.queryByText("K. Weber")).not.toBeInTheDocument();
    expect(screen.queryByText("A. Lindqvist")).not.toBeInTheDocument();

    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Member", "Tier", "Date", "Status", "Amount", "Stripe"]);
  });

  it("formats payment dates through formatDate", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Sophie Dubois/));
    await user.click(originatorRow(/April 2026/));
    expect(screen.getByText("28 Apr 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-04-28")).not.toBeInTheDocument();
  });

  it("links a payment with a Stripe reference to the matching dashboard page", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Sophie Dubois/));
    await user.click(originatorRow(/March 2026/));

    const link = screen.getByRole("link", { name: /A\. Lindqvist/ });
    expect(link).toHaveAttribute("href", "https://dashboard.stripe.com/payments/pi_123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("ph-no-capture");
    expect(link.getAttribute("aria-label")).toMatch(/12 Mar 2026/);
  });

  it("uses the test dashboard when the environment is in test mode", async () => {
    const user = userEvent.setup();
    renderPanel({ stripeTestMode: true });
    await user.click(originatorRow(/Sophie Dubois/));
    await user.click(originatorRow(/March 2026/));
    expect(screen.getByRole("link", { name: /A\. Lindqvist/ })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/test/payments/pi_123",
    );
  });

  it("states the absence in words when a payment has no Stripe reference", async () => {
    // AE3 — never an empty cell.
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Sophie Dubois/));
    await user.click(originatorRow(/April 2026/));

    expect(screen.getByText("No Stripe reference on record")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("expands an originator with referrals but no attributed months to a stated line", async () => {
    // AE6 — a converted referral in range whose first payment clears outside it.
    const user = userEvent.setup();
    renderPanel();
    await user.click(originatorRow(/Rene Sansref/));
    expect(screen.getByText("No attributed payments in this range.")).toBeInTheDocument();
  });

  it("renders the empty state rather than a bare table when there are no originators", () => {
    renderPanel({ originators: [], transactions: [] });
    expect(screen.getByText("No attributed revenue in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("toggles disclosure rows with Enter and with Space", async () => {
    const user = userEvent.setup();
    renderPanel();
    const sophie = originatorRow(/Sophie Dubois/);

    sophie.focus();
    await user.keyboard("{Enter}");
    expect(sophie).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(sophie).toHaveAttribute("aria-expanded", "false");
  });

  it("names all three live caveats", () => {
    renderPanel();
    const caveat = screen.getByTestId("originator-caveats").textContent ?? "";
    expect(caveat).toMatch(/sign-up/i);
    expect(caveat).toMatch(/renewal/i);
    expect(caveat).toMatch(/reassign/i);
    expect(caveat).toMatch(/commission/i);
  });
});
