import { NextResponse, type NextRequest } from "next/server";
import { resolveAudience } from "@/lib/broadcast/audience";
import {
  ALLOWED_AUDIENCE_STATUSES,
} from "@/lib/broadcast/validate";
import type { AudienceFilter } from "@/lib/broadcast/types";
import type { MemberStatus } from "@/types/database";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";

const ENDPOINT = "/api/agent/audience/preview";

/**
 * Audience preview for an agent. Internally calls resolveAudience() which
 * returns full BroadcastRecipient[] (with email + name); this endpoint
 * reduces to counts before responding so a leaked token cannot exfiltrate
 * member PII.
 */
export async function POST(request: NextRequest) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const status = body.status as MemberStatus | "all" | undefined;
  const tierIdsRaw = body.tier_ids;

  if (!status || !ALLOWED_AUDIENCE_STATUSES.includes(status)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 400, started_at });
    return NextResponse.json(
      {
        error: `Invalid status (allowed: ${ALLOWED_AUDIENCE_STATUSES.join(", ")})`,
      },
      { status: 400 }
    );
  }
  if (tierIdsRaw !== undefined && !Array.isArray(tierIdsRaw)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 400, started_at });
    return NextResponse.json(
      { error: "tier_ids must be an array of strings if provided" },
      { status: 400 }
    );
  }
  const tierIds: string[] = Array.isArray(tierIdsRaw)
    ? (tierIdsRaw as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    : [];

  const filter: AudienceFilter = { status, tier_ids: tierIds };

  let resolved;
  try {
    resolved = await resolveAudience(filter);
  } catch (err) {
    console.error("[agent/audience/preview] resolveAudience failed", err);
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 500, started_at });
    return NextResponse.json(
      { error: "Failed to resolve audience" },
      { status: 500 }
    );
  }

  // Build per-tier breakdown without surfacing any recipient field.
  const counts = new Map<string | null, number>();
  for (const r of resolved.recipients) {
    counts.set(r.tier_name, (counts.get(r.tier_name) ?? 0) + 1);
  }
  const perTier = Array.from(counts.entries())
    .map(([tier_name, count]) => ({ tier_name, count }))
    .sort((a, b) => b.count - a.count);

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "POST",
    status_code: 200,
    started_at,
    extra: { recipient_count: resolved.recipients.length },
  });
  return NextResponse.json({
    recipient_count: resolved.recipients.length,
    skipped_count: resolved.skipped,
    per_tier: perTier,
  });
}
