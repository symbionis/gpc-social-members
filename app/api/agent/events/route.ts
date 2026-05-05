import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";

const ENDPOINT = "/api/agent/events";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const status = searchParams.get("status") ?? "published";
  const eventTypeId = searchParams.get("event_type_id");
  const from = searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = searchParams.get("to");
  const limit = clampLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("offset"));

  if (!ISO_DATE.test(from)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json(
      { error: "Invalid 'from' — expected YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (to && !ISO_DATE.test(to)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json(
      { error: "Invalid 'to' — expected YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (status !== "published" && status !== "draft" && status !== "all") {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json(
      { error: "Invalid 'status' — allowed: published | draft | all" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  let query = supabase
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, location, description, image_url, image_url_2, images, visibility, is_published, is_confirmed, registration_enabled, price_member, price_non_member, event_type_id, season_id"
    )
    .gte("start_date", from)
    .order("start_date", { ascending: true })
    .range(offset, offset + limit - 1);

  if (to) query = query.lte("start_date", to);
  if (eventTypeId) query = query.eq("event_type_id", eventTypeId);
  if (status === "published") query = query.eq("is_published", true);
  else if (status === "draft") query = query.eq("is_published", false);

  const { data, error } = await query;
  if (error) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 500, started_at });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "GET",
    status_code: 200,
    started_at,
    extra: { count: data?.length ?? 0 },
  });
  return NextResponse.json({ events: data ?? [], limit, offset });
}
