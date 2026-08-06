// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

const push = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/admin/finance",
  useSearchParams: () => new URLSearchParams(search),
}));

import DateRangeFilter from "@/components/admin/finance/DateRangeFilter";

beforeEach(() => {
  push.mockClear();
  search = "tab=originator&from=2026-01-01&to=2026-06-30";
});

function pushedParams(): URLSearchParams {
  expect(push).toHaveBeenCalledTimes(1);
  const url: string = push.mock.calls[0][0];
  expect(url.startsWith("/admin/finance?")).toBe(true);
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

describe("DateRangeFilter", () => {
  it("keeps the active tab when a new range is applied", async () => {
    // AE4: from ?tab=originator&…, Apply lands back on ?tab=originator.
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-01-01" to="2026-06-30" />);

    const to = screen.getByLabelText("To");
    await user.clear(to);
    await user.type(to, "2026-09-30");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const params = pushedParams();
    expect(params.get("tab")).toBe("originator");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-09-30");
  });

  it.each(["This year", "Last 30 days", "Last 90 days"])(
    "keeps the active tab when the %s preset is used",
    async (label) => {
      const user = userEvent.setup();
      render(<DateRangeFilter from="2026-01-01" to="2026-06-30" />);
      await user.click(screen.getByRole("button", { name: label }));
      expect(pushedParams().get("tab")).toBe("originator");
    },
  );

  it("preserves unrelated query params rather than replacing the query string", async () => {
    search = "tab=events&keep=me";
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-01-01" to="2026-06-30" />);
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const params = pushedParams();
    expect(params.get("keep")).toBe("me");
    expect(params.get("tab")).toBe("events");
  });

  it("works from a bare URL with no existing params", async () => {
    search = "";
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-01-01" to="2026-06-30" />);
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const params = pushedParams();
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-06-30");
    expect(params.get("tab")).toBeNull();
  });
});
