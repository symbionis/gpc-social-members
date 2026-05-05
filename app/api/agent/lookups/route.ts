import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";

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
  const today = new Date().toISOString().slice(0, 10);

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
      .lte("start_date", today)
      .gte("end_date", today)
      .limit(1),
  ]);

  const firstError = [tiersRes, typesRes, seasonsRes].find((r) => r.error);
  if (firstError?.error) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 500, started_at });
    return NextResponse.json(
      { error: firstError.error.message },
      { status: 500 }
    );
  }

  trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 200, started_at });
  return NextResponse.json({
    tiers: tiersRes.data ?? [],
    event_types: typesRes.data ?? [],
    current_season: seasonsRes.data?.[0] ?? null,
  });
}
