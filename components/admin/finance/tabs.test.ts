import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tabFrom, FINANCE_TABS } from "@/components/admin/finance/tabs";

describe("tabFrom", () => {
  it("defaults to Membership when the param is absent", () => {
    expect(tabFrom(undefined)).toBe("membership");
  });

  it("accepts each known tab", () => {
    for (const tab of FINANCE_TABS) {
      expect(tabFrom(tab.id)).toBe(tab.id);
    }
  });

  it("falls back to Membership for an unrecognized value", () => {
    expect(tabFrom("bogus")).toBe("membership");
    expect(tabFrom("")).toBe("membership");
  });

  it("falls back to Membership for a repeated param arriving as an array", () => {
    expect(tabFrom(["events", "originator"])).toBe("membership");
  });
});

describe("server/client boundary", () => {
  // /admin/finance is a server component and CALLS tabFrom to normalize ?tab=.
  // Every export of a "use client" module is a client reference, which the
  // server may render as a component but may never invoke as a function. When
  // this normalizer lived in FinanceTabs.tsx the build stayed green and every
  // request to /admin/finance threw:
  //   "Attempted to call tabFrom() from the server but tabFrom is on the client."
  // Neither typecheck, lint, nor `next build` catches that, so assert it here.
  it("keeps the tabs module free of a 'use client' directive", () => {
    const source = readFileSync(
      join(process.cwd(), "components/admin/finance/tabs.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});
