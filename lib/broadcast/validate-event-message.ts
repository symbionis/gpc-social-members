import type { EventMessageKind } from "@/lib/broadcast/event-audience";

export interface EventMessagePayload {
  kind: EventMessageKind;
  subject: string;
  body_html: string;
  /** event_post only; always false for event_pre. */
  include_non_consented: boolean;
  idempotency_key: string | null;
}

export type ValidatedEventMessage =
  | { ok: true; payload: EventMessagePayload }
  | { ok: false; error: string };

/**
 * Validate an event-message payload (kind, subject, body, override, idempotency
 * key). Mirrors `parseBroadcastPayload`: trims the subject and applies the same
 * strip-tag emptiness check on the body before it reaches the email template.
 *
 * `forPreview` relaxes the subject/body checks — the recipient-count preview
 * fires before the admin has composed anything. `include_non_consented` is only
 * honored for event_post; pre-event has no consent filter.
 */
export function parseEventMessagePayload(
  body: unknown,
  opts: { forPreview?: boolean } = {}
): ValidatedEventMessage {
  const b = (body ?? {}) as Record<string, unknown>;

  const kind = b.kind;
  if (kind !== "event_pre" && kind !== "event_post") {
    return { ok: false, error: "kind must be event_pre or event_post" };
  }

  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  const bodyHtml = typeof b.body_html === "string" ? b.body_html : "";

  if (!opts.forPreview) {
    if (!subject) return { ok: false, error: "subject is required" };
    if (!bodyHtml || bodyHtml.replace(/<[^>]+>/g, "").trim().length === 0) {
      return { ok: false, error: "body is required" };
    }
  }

  const include_non_consented =
    kind === "event_post" && b.include_non_consented === true;

  const idempotency_key =
    typeof b.idempotency_key === "string" && b.idempotency_key.length > 0
      ? b.idempotency_key
      : null;

  return {
    ok: true,
    payload: { kind, subject, body_html: bodyHtml, include_non_consented, idempotency_key },
  };
}
