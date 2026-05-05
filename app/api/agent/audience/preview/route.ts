import { NextResponse, type NextRequest } from "next/server";
import { previewAudienceCounts } from "@/lib/broadcast/audience";
import { ALLOWED_AUDIENCE_STATUSES } from "@/lib/broadcast/validate";
import type { AudienceFilter } from "@/lib/broadcast/types";
import type { MemberStatus } from "@/types/database";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type {
  AgentApiError,
  AudiencePreviewResponse,
} from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/audience/preview";

/**
 * Audience preview for an agent. Calls previewAudienceCounts() which uses
 * head-only count queries — recipient rows (and therefore email/name) are
 * never loaded into the server process. A leaked agent token cannot
 * exfiltrate member PII through this endpoint.
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
    return NextResponse.json<AgentApiError>(
      {
        error: `Invalid status (allowed: ${ALLOWED_AUDIENCE_STATUSES.join(", ")})`,
      },
      { status: 400 }
    );
  }
  if (tierIdsRaw !== undefined && !Array.isArray(tierIdsRaw)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 400, started_at });
    return NextResponse.json<AgentApiError>(
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

  let counts;
  try {
    counts = await previewAudienceCounts(filter);
  } catch (err) {
    console.error("[agent/audience/preview] previewAudienceCounts failed", err);
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 500, started_at });
    return NextResponse.json<AgentApiError>(
      { error: "Failed to resolve audience" },
      { status: 500 }
    );
  }

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "POST",
    status_code: 200,
    started_at,
    extra: { recipient_count: counts.recipient_count },
  });
  return NextResponse.json<AudiencePreviewResponse>(counts);
}
