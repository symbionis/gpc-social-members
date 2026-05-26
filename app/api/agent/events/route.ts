import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type {
  AgentApiError,
  AgentTicketType,
  EventsListResponse,
} from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/events";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ALLOWED_EVENT_STATUSES = ["published", "draft", "all"] as const;
type EventStatusFilter = (typeof ALLOWED_EVENT_STATUSES)[number];

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

function isEventStatus(v: string): v is EventStatusFilter {
  return (ALLOWED_EVENT_STATUSES as readonly string[]).includes(v);
}

export async function GET(request: NextRequest) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const { searchParams } = new URL(request.url);
  const statusRaw = searchParams.get("status") ?? "published";
  const eventTypeId = searchParams.get("event_type_id");
  const from = searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = searchParams.get("to");
  const limit = clampLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("offset"));

  if (!isEventStatus(statusRaw)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json<AgentApiError>(
      {
        error: `Invalid 'status' — allowed: ${ALLOWED_EVENT_STATUSES.join(" | ")}`,
      },
      { status: 400 }
    );
  }
  const status: EventStatusFilter = statusRaw;
  if (!ISO_DATE.test(from)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json<AgentApiError>(
      { error: "Invalid 'from' — expected YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (to && !ISO_DATE.test(to)) {
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 400, started_at });
    return NextResponse.json<AgentApiError>(
      { error: "Invalid 'to' — expected YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  let query = supabase
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, location, description, image_url, image_url_2, images, visibility, is_published, is_confirmed, registration_enabled, strict_checkin, seat_cap, event_type_id, season_id"
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
    console.error("[agent/events] query failed", error);
    trackAgentAction({ endpoint: ENDPOINT, method: "GET", status_code: 500, started_at });
    return NextResponse.json<AgentApiError>(
      { error: error.message },
      { status: 500 }
    );
  }

  // Attach each event's active ticket types (per-type prices replaced the old
  // per-event price columns).
  const eventIds = (data ?? []).map((e) => e.id);
  const { data: tts } = eventIds.length
    ? await supabase
        .from("event_ticket_types")
        .select("id, event_id, title, price_member, price_non_member, invite_price, counts_as_seat, sort_order")
        .in("event_id", eventIds)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
    : { data: [] as (AgentTicketType & { event_id: string })[] };

  const ttByEvent = new Map<string, AgentTicketType[]>();
  for (const t of tts ?? []) {
    const arr = ttByEvent.get(t.event_id) ?? [];
    arr.push({
      id: t.id,
      title: t.title,
      price_member: t.price_member,
      price_non_member: t.price_non_member,
      invite_price: t.invite_price,
      counts_as_seat: t.counts_as_seat,
      sort_order: t.sort_order,
    });
    ttByEvent.set(t.event_id, arr);
  }

  const events = (data ?? []).map((e) => ({ ...e, ticket_types: ttByEvent.get(e.id) ?? [] }));

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "GET",
    status_code: 200,
    started_at,
    extra: { count: events.length },
  });
  return NextResponse.json<EventsListResponse>({ events, limit, offset });
}
