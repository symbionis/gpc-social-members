import { describe, it, expect } from "vitest";
import {
  stripeDashboardUrl,
  stripeRefLabel,
  stripeTestModeFromKey,
  type StripeRef,
} from "@/lib/stripe/dashboard";

const paymentIntent: StripeRef = { kind: "payment_intent", id: "pi_123" };
const checkoutSession: StripeRef = { kind: "checkout_session", id: "cs_123" };

describe("stripeDashboardUrl", () => {
  it("points a PaymentIntent at the live dashboard when not in test mode", () => {
    expect(stripeDashboardUrl(paymentIntent, false)).toBe(
      "https://dashboard.stripe.com/payments/pi_123",
    );
  });

  it("points a PaymentIntent at the test dashboard in test mode", () => {
    expect(stripeDashboardUrl(paymentIntent, true)).toBe(
      "https://dashboard.stripe.com/test/payments/pi_123",
    );
  });

  it("points a Checkout Session at the sessions path in both modes", () => {
    expect(stripeDashboardUrl(checkoutSession, false)).toBe(
      "https://dashboard.stripe.com/checkout/sessions/cs_123",
    );
    expect(stripeDashboardUrl(checkoutSession, true)).toBe(
      "https://dashboard.stripe.com/test/checkout/sessions/cs_123",
    );
  });

  it("returns null for a null ref in both modes", () => {
    expect(stripeDashboardUrl(null, false)).toBeNull();
    expect(stripeDashboardUrl(null, true)).toBeNull();
  });
});

describe("stripeTestModeFromKey", () => {
  // KTD9: test for the LIVE marker, so anything unrecognized fails safe to test
  // mode rather than pointing an admin at real production payments.
  it("fails safe to test mode when the key is absent or empty", () => {
    expect(stripeTestModeFromKey(undefined)).toBe(true);
    expect(stripeTestModeFromKey(null)).toBe(true);
    expect(stripeTestModeFromKey("")).toBe(true);
  });

  it("fails safe to test mode for an unrecognized key shape", () => {
    expect(stripeTestModeFromKey("REDACTED")).toBe(true);
    expect(stripeTestModeFromKey("sk_staging_abc")).toBe(true);
  });

  it("resolves a live secret or restricted key to live mode", () => {
    expect(stripeTestModeFromKey("sk_live_abc123")).toBe(false);
    expect(stripeTestModeFromKey("rk_live_abc123")).toBe(false);
  });

  it("resolves a test key to test mode", () => {
    expect(stripeTestModeFromKey("sk_test_abc123")).toBe(true);
  });
});

describe("stripeRefLabel", () => {
  it("names each reference kind without the caller branching on kind", () => {
    expect(stripeRefLabel(paymentIntent)).toBe("payment");
    expect(stripeRefLabel(checkoutSession)).toBe("checkout session");
  });
});
