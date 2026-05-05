import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type { AgentApiError, LookupsResponse } from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/lookups";

/**
 * Reference data the agent needs to construct valid filters and drafts:
 * tiers, event types, current season. No PII; safe to cache aggressively
 * on the agent side.
 */
export async function GET(request: NextRequest) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const supabase = createAdminClient();

  const [tiersRes, typesRes, seasonsRes] = await Promise.all([
    supabase
      .from("membership_tiers")
      .select("id, name, slug, category, price_eur, is_active, sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("event_types")
      .select("id, name, slug, color, sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("seasons")
      .select("id, name, slug, start_date, end_date, is_current")
      .eq("is_current", true)
      .limit(1),
  ]);

  // Log every error before responding so a multi-table outage isn't a
  // guessing game from the surfaced one.
  const errors = [tiersRes, typesRes, seasonsRes]
    .map((r) => r.error)
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  if (errors.length > 0) {
    for (const e of errors) console.error("[agent/lookups]", e);
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 500, started_at });
    return NextResponse.json<AgentApiError>(
      { error: errors[0].message },
      { status: 500 }
    );
  }

  trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 200, started_at });
  return NextResponse.json<LookupsResponse>({
    tiers: tiersRes.data ?? [],
    event_types: typesRes.data ?? [],
    current_season: seasonsRes.data?.[0] ?? null,
  });
}
