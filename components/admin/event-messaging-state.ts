/** Pure helpers for the EventMessaging composer, extracted so the gating and
 *  confirmation logic is unit-testable without a DOM (the repo unit-tests pure
 *  logic; component rendering is covered by Playwright E2E). */

export type EventMessageKind = "event_pre" | "event_post";

export interface SendGateInput {
  subjectEmpty: boolean;
  bodyEmpty: boolean;
  /** null until a recipient-count preview has completed. */
  recipientCount: number | null;
  fetchingCount: boolean;
  sending: boolean;
}

/** Send is enabled only with a non-empty subject + body, a completed count
 *  fetch that found at least one recipient, and nothing in flight. */
export function computeCanSend(i: SendGateInput): boolean {
  return (
    !i.subjectEmpty &&
    !i.bodyEmpty &&
    !i.fetchingCount &&
    !i.sending &&
    i.recipientCount !== null &&
    i.recipientCount > 0
  );
}

/** body_html is "empty" when it has no text content after stripping tags —
 *  matches the server-side validator and the member composer. */
export function isBodyEmpty(bodyHtml: string): boolean {
  return !bodyHtml || bodyHtml.replace(/<[^>]+>/g, "").trim().length === 0;
}

/** Confirmation prompt shown before an irreversible send. For a post-event send
 *  with the consent override on, it explicitly states that the message reaches
 *  attendees who did not opt in. */
export function buildSendConfirm(i: {
  subject: string;
  kind: EventMessageKind;
  recipientCount: number;
  includeNonConsented: boolean;
}): string {
  const who = i.kind === "event_pre" ? "registered attendee" : "checked-in attendee";
  const plural = i.recipientCount === 1 ? "" : "s";
  let msg = `Send "${i.subject}" to ${i.recipientCount} ${who}${plural}?`;
  if (i.kind === "event_post" && i.includeNonConsented) {
    msg += " This includes attendees who have not opted in to marketing.";
  }
  return msg;
}
