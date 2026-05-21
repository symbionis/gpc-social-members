import { describe, it, expect } from "vitest";
import { parseEventMessagePayload } from "@/lib/broadcast/validate-event-message";

describe("parseEventMessagePayload", () => {
  const ok = { kind: "event_pre", subject: "Hi", body_html: "<p>Body</p>" };

  it("rejects an invalid kind", () => {
    const r = parseEventMessagePayload({ ...ok, kind: "newsletter" });
    expect(r.ok).toBe(false);
  });

  it("requires a non-empty subject and body on send", () => {
    expect(parseEventMessagePayload({ ...ok, subject: "  " }).ok).toBe(false);
    expect(parseEventMessagePayload({ ...ok, body_html: "<p></p>" }).ok).toBe(false);
  });

  it("relaxes subject/body for a preview", () => {
    const r = parseEventMessagePayload({ kind: "event_post" }, { forPreview: true });
    expect(r.ok).toBe(true);
  });

  it("clamps include_non_consented to false for pre-event", () => {
    const r = parseEventMessagePayload({ ...ok, kind: "event_pre", include_non_consented: true });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.include_non_consented).toBe(false);
  });

  it("honors include_non_consented only for post-event", () => {
    const r = parseEventMessagePayload({
      kind: "event_post",
      subject: "Hi",
      body_html: "<p>x</p>",
      include_non_consented: true,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.include_non_consented).toBe(true);
  });

  it("coerces an empty idempotency_key to null and trims the subject", () => {
    const r = parseEventMessagePayload({ ...ok, subject: "  Trim me  ", idempotency_key: "" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.idempotency_key).toBeNull();
    expect(r.payload.subject).toBe("Trim me");
  });

  it("keeps a non-empty idempotency_key", () => {
    const r = parseEventMessagePayload({ ...ok, idempotency_key: "abc-123" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.idempotency_key).toBe("abc-123");
  });
});
