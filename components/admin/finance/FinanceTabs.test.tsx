// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

import FinanceTabs, { tabFrom } from "@/components/admin/finance/FinanceTabs";

describe("tabFrom", () => {
  it("defaults to Membership when the param is absent", () => {
    expect(tabFrom(undefined)).toBe("membership");
  });

  it("accepts each known tab", () => {
    expect(tabFrom("membership")).toBe("membership");
    expect(tabFrom("events")).toBe("events");
    expect(tabFrom("originator")).toBe("originator");
  });

  it("falls back to Membership for an unrecognized value", () => {
    expect(tabFrom("bogus")).toBe("membership");
    expect(tabFrom("")).toBe("membership");
  });

  it("falls back to Membership for a repeated param arriving as an array", () => {
    expect(tabFrom(["events", "originator"])).toBe("membership");
  });
});

describe("FinanceTabs", () => {
  function renderTabs(over: Partial<React.ComponentProps<typeof FinanceTabs>> = {}) {
    const onSelect = vi.fn();
    render(
      <FinanceTabs
        active="membership"
        from="2026-01-01"
        to="2026-06-30"
        pending={null}
        onSelect={onSelect}
        {...over}
      />,
    );
    return { onSelect };
  }

  it("carries the current range on every tab link", () => {
    renderTabs();
    for (const [label, id] of [
      ["Membership", "membership"],
      ["Events", "events"],
      ["Originator", "originator"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `/admin/finance?from=2026-01-01&to=2026-06-30&tab=${id}`,
      );
    }
  });

  it("marks exactly one tab current", () => {
    renderTabs({ active: "originator" });
    const current = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Originator");
  });

  it("gives exactly one tab the active styling", () => {
    renderTabs({ active: "events" });
    const active = screen
      .getAllByRole("link")
      .filter((a) => a.className.includes("border-marine"));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("Events");
  });

  it("reports a selection so the caller can show loading feedback", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs();
    await user.click(screen.getByRole("link", { name: "Originator" }));
    expect(onSelect).toHaveBeenCalledWith("originator");
  });

  it("does not report a selection when the active tab is clicked again", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs({ active: "membership" });
    await user.click(screen.getByRole("link", { name: "Membership" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("announces the pending tab while its navigation is in flight", () => {
    renderTabs({ active: "membership", pending: "events" });
    expect(screen.getByRole("link", { name: /Events\s*\(loading\)/ })).toHaveAttribute(
      "data-pending",
      "true",
    );
    expect(screen.getByRole("link", { name: "Membership" })).not.toHaveAttribute("data-pending");
  });
});
