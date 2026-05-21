import type { AudienceFilter } from "@/lib/broadcast/types";
import type { MemberStatus } from "@/types/database";
import { isHtmlBodyEmpty } from "@/lib/broadcast/html-body";

export const ALLOWED_AUDIENCE_STATUSES: Array<MemberStatus | "all"> = [
  "all",
  "active",
  "expired",
];

export interface BroadcastPayload {
  subject: string;
  body_html: string;
  audience_filter: AudienceFilter;
}

export type ValidatedPayload =
  | { ok: true; payload: BroadcastPayload }
  | { ok: false; error: string };

/**
 * Coerce + validate a broadcast composer payload (subject, body, audience).
 *
 * Used by both the send route and the draft routes so a single rule set
 * defines what counts as a sendable / saveable broadcast. Drafts use the
 * `forDraft` flag to relax the "non-empty subject and body" checks — the
 * whole point of a draft is that it can be partial.
 *
 * Tolerates the legacy `audience_filter.tier_id` (singular) shape on read,
 * but always returns the canonical plural `tier_ids` form. See
 * docs/solutions/conventions/jsonb-filter-singular-to-plural-evolution.md.
 */
export function parseBroadcastPayload(
  body: unknown,
  opts: { forDraft?: boolean } = {}
): ValidatedPayload {
  const b = (body ?? {}) as Record<string, unknown>;

  const subject =
    typeof b.subject === "string" ? b.subject.trim() : "";
  const bodyHtml = typeof b.body_html === "string" ? b.body_html : "";
  const filterRaw = (b.audience_filter ?? {}) as Record<string, unknown>;
  const status = filterRaw.status as MemberStatus | "all" | undefined;
  const tierIds: string[] = Array.isArray(filterRaw.tier_ids)
    ? (filterRaw.tier_ids as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    : typeof filterRaw.tier_id === "string" && (filterRaw.tier_id as string).length > 0
      ? [filterRaw.tier_id as string]
      : [];

  if (!opts.forDraft) {
    if (!subject) return { ok: false, error: "subject is required" };
    if (isHtmlBodyEmpty(bodyHtml)) {
      return { ok: false, error: "body is required" };
    }
  }

  if (!status || !ALLOWED_AUDIENCE_STATUSES.includes(status)) {
    return {
      ok: false,
      error: `Invalid audience.status (allowed: ${ALLOWED_AUDIENCE_STATUSES.join(", ")})`,
    };
  }

  return {
    ok: true,
    payload: {
      subject,
      body_html: bodyHtml,
      audience_filter: { status, tier_ids: tierIds },
    },
  };
}
