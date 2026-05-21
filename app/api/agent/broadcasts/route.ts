import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type {
  AgentApiError,
  BroadcastsListResponse,
} from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/broadcasts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_STATUSES = ["sent", "draft", "sending", "failed", "all"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseOffset(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function GET(request: NextRequest) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "all") as AllowedStatus;
  const limit = clampLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("offset"));

  if (!ALLOWED_STATUSES.includes(status)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json<AgentApiError>(
      {
        error: `Invalid 'status' — allowed: ${ALLOWED_STATUSES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Explicit columns; body_html intentionally omitted (large + private).
  let query = supabase
    .from("broadcasts")
    .select(
      "id, subject, status, audience_filter, recipient_count, error_count, skipped_count, created_at, sent_at, channel"
    )
    .is("event_id", null) // member broadcasts only; event sends are surfaced per-event
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("[agent/broadcasts] query failed", error);
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 500, started_at });
    return NextResponse.json<AgentApiError>(
      { error: error.message },
      { status: 500 }
    );
  }

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "GET",
    status_code: 200,
    started_at,
    extra: { count: data?.length ?? 0 },
  });
  return NextResponse.json<BroadcastsListResponse>({
    broadcasts: data ?? [],
    limit,
    offset,
  });
}
