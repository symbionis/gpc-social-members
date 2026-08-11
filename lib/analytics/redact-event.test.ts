import { describe, it, expect } from "vitest";
import { redactAnalyticsEvent } from "./redact-event";

const TOKEN = "liveOfferToken123";
const OFFER_URL = `https://members.example.com/public/offers/${TOKEN}`;

describe("redactAnalyticsEvent", () => {
  // The regression this file exists for. The redaction used to sit below the
  // $exception branch / apply to too little, so an ordinary autocapture click on
  // the offer landing shipped the live token while every helper test stayed green.
  it("redacts the token from a non-$exception autocapture event", () => {
    const event = redactAnalyticsEvent({
      event: "$autocapture",
      properties: { $current_url: OFFER_URL, $pathname: `/public/offers/${TOKEN}` },
    });

    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(event?.properties?.$pathname).toBe("/public/offers/[token]");
  });

  it("redacts the token from a $pageview", () => {
    const event = redactAnalyticsEvent({
      event: "$pageview",
      properties: { $current_url: OFFER_URL },
    });
    expect(event?.properties?.$current_url).toBe(
      "https://members.example.com/public/offers/[token]"
    );
  });

  // AE8: the members-only sign-in round trip carries the token in ?next=.
  it("redacts the token from a /login ?next= URL", () => {
    const event = redactAnalyticsEvent({
      event: "$autocapture",
      properties: {
        $current_url: `https://members.example.com/login?next=${encodeURIComponent(
          `/public/offers/${TOKEN}`
        )}`,
        $pathname: "/login",
      },
    });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  it("preserves the query string on a redacted URL", () => {
    const event = redactAnalyticsEvent({
      event: "$pageview",
      properties: { $current_url: `${OFFER_URL}?registered=1` },
    });
    expect(event?.properties?.$current_url).toContain("registered=1");
    expect(event?.properties?.$current_url).not.toContain(TOKEN);
  });

  it("redacts an $exception it keeps", () => {
    const event = redactAnalyticsEvent({
      event: "$exception",
      properties: {
        $current_url: OFFER_URL,
        $exception_list: [{ value: "TypeError: real bug" }],
      },
    });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  it.each([
    "Object Not Found Matching Id",
    "Java object is gone",
    "window.webkit.messageHandlers is undefined",
  ])("drops third-party noise: %s", (value) => {
    expect(
      redactAnalyticsEvent({
        event: "$exception",
        properties: { $exception_list: [{ value }] },
      })
    ).toBeNull();
  });

  it("keeps a genuine exception", () => {
    const event = redactAnalyticsEvent({
      event: "$exception",
      properties: { $exception_list: [{ value: "TypeError: x is not a function" }] },
    });
    expect(event).not.toBeNull();
  });

  it("passes through a null event and one with no properties", () => {
    expect(redactAnalyticsEvent(null)).toBeNull();
    expect(redactAnalyticsEvent({ event: "$pageview" })).toEqual({
      event: "$pageview",
    });
  });

  it("leaves a malformed $current_url intact rather than throwing", () => {
    expect(() =>
      redactAnalyticsEvent({
        event: "$pageview",
        properties: { $current_url: "not a url" },
      })
    ).not.toThrow();
  });
});
