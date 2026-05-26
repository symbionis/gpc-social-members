import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  getFlyerEvents,
  getMemberEventsUrl,
  shortenDescription,
  isUpcoming,
  heroImage,
} from "@/lib/events/flyer";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type Row = Record<string, unknown>;

// Minimal chainable Supabase stub. `.from(table)` resolves (via thenable) to the
// rows configured for that table; `.eq(col, val)` records the filter so tests
// can assert the published/confirmed gate is applied server-side.
function client(
  tables: { events?: Row[]; event_types?: Row[] },
  eqCalls: Array<[string, unknown]> = [],
) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return c;
      };
      c.order = () => c;
      c.in = () => c;
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: tables[table as keyof typeof tables] ?? [], error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Noon UTC on 2026-05-26 → Europe/Zurich calendar date 2026-05-26.
  vi.setSystemTime(new Date("2026-05-26T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_MEMBER_EVENTS_URL;
});

describe("getMemberEventsUrl", () => {
  it("defaults to the production member-events URL", () => {
    expect(getMemberEventsUrl()).toBe("https://social.genevapolo.com/events");
  });

  it("uses the env override when set", () => {
    process.env.NEXT_PUBLIC_MEMBER_EVENTS_URL = "https://staging.example.com/events";
    expect(getMemberEventsUrl()).toBe("https://staging.example.com/events");
  });

  it("falls back when the env override is blank", () => {
    process.env.NEXT_PUBLIC_MEMBER_EVENTS_URL = "   ";
    expect(getMemberEventsUrl()).toBe("https://social.genevapolo.com/events");
  });
});

describe("shortenDescription", () => {
  it("strips HTML tags to plain text", () => {
    expect(shortenDescription("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  it("collapses whitespace and newlines to single spaces", () => {
    expect(shortenDescription("<p>One</p>\n\n<p>Two   three</p>")).toBe("One Two three");
  });

  it("truncates long text on a word boundary with an ellipsis", () => {
    const long = `${"word ".repeat(60)}`.trim(); // 300 chars
    const out = shortenDescription(long, 40);
    expect(out.length).toBeLessThanOrEqual(41); // 40 + ellipsis, minus trailing space
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
    // does not cut mid-word
    expect(out.slice(0, -1).trim().split(" ").every((w) => w === "word")).toBe(true);
  });

  it("leaves short plain text unchanged", () => {
    expect(shortenDescription("Polo at sunset", 160)).toBe("Polo at sunset");
  });

  it("returns empty string for null, undefined, and empty input", () => {
    expect(shortenDescription(null)).toBe("");
    expect(shortenDescription(undefined)).toBe("");
    expect(shortenDescription("")).toBe("");
  });
});

describe("isUpcoming", () => {
  const today = "2026-05-26";

  it("includes a future single-day event", () => {
    expect(isUpcoming({ start_date: "2026-06-01" }, today)).toBe(true);
  });

  it("includes an event happening today", () => {
    expect(isUpcoming({ start_date: "2026-05-26" }, today)).toBe(true);
  });

  it("includes an in-progress multi-day event (started before today, ends later)", () => {
    expect(isUpcoming({ start_date: "2026-05-20", end_date: "2026-05-30" }, today)).toBe(true);
  });

  it("excludes a fully past event", () => {
    expect(isUpcoming({ start_date: "2026-05-01", end_date: "2026-05-02" }, today)).toBe(false);
  });

  it("uses end_date when present, not start_date", () => {
    expect(isUpcoming({ start_date: "2026-05-20", end_date: "2026-05-25" }, today)).toBe(false);
  });
});

describe("heroImage", () => {
  it("uses the first non-empty entry in the images array", () => {
    expect(heroImage({ images: ["", "https://cdn/a.jpg", "https://cdn/b.jpg"] })).toBe(
      "https://cdn/a.jpg",
    );
  });

  it("falls back to image_url when images is empty or absent", () => {
    expect(heroImage({ images: [], image_url: "https://cdn/legacy.jpg" })).toBe(
      "https://cdn/legacy.jpg",
    );
    expect(heroImage({ image_url: "https://cdn/legacy.jpg" })).toBe(
      "https://cdn/legacy.jpg",
    );
  });

  it("falls back to image_url_2 when image_url is missing", () => {
    expect(heroImage({ image_url: null, image_url_2: "https://cdn/second.jpg" })).toBe(
      "https://cdn/second.jpg",
    );
  });

  it("returns null when no image is available", () => {
    expect(heroImage({ images: [], image_url: null, image_url_2: null })).toBeNull();
    expect(heroImage({})).toBeNull();
  });
});

describe("getFlyerEvents", () => {
  it("returns confirmed+published upcoming events, ordered, typed, and shortened", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    mockedCreateAdminClient.mockReturnValue(
      client(
        {
          events: [
            // in-progress multi-day — included via end_date
            {
              id: "e2",
              title: "Spring Tournament",
              start_date: "2026-05-20",
              end_date: "2026-05-30",
              start_time: "11:00:00",
              description: "<p>Three days of polo</p>",
              event_type_id: "t1",
              images: ["https://cdn/tournament.jpg"],
              image_url: null,
              image_url_2: null,
            },
            // future single-day, no type, legacy single-image field
            {
              id: "e1",
              title: "Sunset Social",
              start_date: "2026-06-01",
              end_date: null,
              start_time: "18:30:00",
              description: "<p>Drinks &amp; canapés</p>",
              event_type_id: null,
              images: [],
              image_url: "https://cdn/social.jpg",
              image_url_2: null,
            },
            // past — excluded by isUpcoming
            {
              id: "e0",
              title: "Old Match",
              start_date: "2026-05-01",
              end_date: "2026-05-02",
              start_time: null,
              description: null,
              event_type_id: "t1",
            },
          ],
          event_types: [{ id: "t1", name: "Tournament" }],
        },
        eqCalls,
      ),
    );

    const result = await getFlyerEvents();

    // Past event dropped; upcoming kept in given (chronological) order.
    expect(result.map((e) => e.id)).toEqual(["e2", "e1"]);

    // Server-side gate: both published AND confirmed required.
    expect(eqCalls).toContainEqual(["is_published", true]);
    expect(eqCalls).toContainEqual(["is_confirmed", true]);

    // Type name resolved for typed event; null for untyped.
    expect(result[0]).toMatchObject({
      id: "e2",
      title: "Spring Tournament",
      typeName: "Tournament",
      startTime: "11:00:00",
      endDate: "2026-05-30",
      description: "Three days of polo",
      imageUrl: "https://cdn/tournament.jpg",
    });
    expect(result[1]).toMatchObject({
      id: "e1",
      typeName: null,
      description: "Drinks & canapés",
      imageUrl: "https://cdn/social.jpg",
    });
  });

  it("returns an empty array when the query errors", async () => {
    mockedCreateAdminClient.mockReturnValue({
      from: () => {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.order = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: null, error: { message: "boom" } });
        return c;
      },
    } as unknown as ReturnType<typeof createAdminClient>);

    expect(await getFlyerEvents()).toEqual([]);
  });
});
