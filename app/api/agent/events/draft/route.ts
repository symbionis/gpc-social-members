import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type {
  AgentApiError,
  EventDraftCreatedResponse,
} from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/events/draft";

function track400(started_at: number) {
  trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 400, started_at });
}

function track500(started_at: number) {
  trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 500, started_at });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const ALLOWED_VISIBILITIES = ["public", "members_only"] as const;
type Visibility = (typeof ALLOWED_VISIBILITIES)[number];

function isVisibility(v: string): v is Visibility {
  return (ALLOWED_VISIBILITIES as readonly string[]).includes(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s): s is string => s.length > 0);
}

/**
 * Agent-facing endpoint to create a draft event. Forces is_published=false
 * regardless of input — admins keep the publish gate.
 */
export async function POST(request: NextRequest) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const title = asString(body.title);
  const startDate = asString(body.start_date);
  const eventTypeId = asString(body.event_type_id);

  if (!title) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "title is required" },
      { status: 400 }
    );
  }
  if (!startDate || !ISO_DATE.test(startDate)) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "start_date is required and must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (!eventTypeId) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "event_type_id is required" },
      { status: 400 }
    );
  }

  const endDate = asString(body.end_date);
  if (endDate && !ISO_DATE.test(endDate)) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "end_date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (endDate && endDate < startDate) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "end_date must be on or after start_date" },
      { status: 400 }
    );
  }

  const startTime = asString(body.start_time);
  if (startTime && !TIME.test(startTime)) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "start_time must be HH:MM or HH:MM:SS" },
      { status: 400 }
    );
  }

  const visibilityRaw = asString(body.visibility) ?? "public";
  if (!isVisibility(visibilityRaw)) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      {
        error: `visibility must be one of: ${ALLOWED_VISIBILITIES.join(", ")}`,
      },
      { status: 400 }
    );
  }
  const visibility: Visibility = visibilityRaw;

  const seasonId = asString(body.season_id);
  const location = asString(body.location);
  const description = asString(body.description);
  const images = asStringArray(body.images);

  const supabase = createAdminClient();

  // Validate referenced FKs early so the agent gets a friendly error
  // instead of a Postgres FK violation 500. Distinguish a real Supabase
  // error (network, RLS, table missing) from "row not found" — the former
  // should surface as 500, not as a misleading "Unknown ..." 400.
  const typeRes = await supabase
    .from("event_types")
    .select("id")
    .eq("id", eventTypeId)
    .limit(1)
    .maybeSingle();
  if (typeRes.error) {
    console.error("[agent/events/draft] event_type lookup failed", typeRes.error);
    track500(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "Failed to validate event_type_id" },
      { status: 500 }
    );
  }
  if (!typeRes.data) {
    track400(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "Unknown event_type_id" },
      { status: 400 }
    );
  }
  if (seasonId) {
    const seasonRes = await supabase
      .from("seasons")
      .select("id")
      .eq("id", seasonId)
      .limit(1)
      .maybeSingle();
    if (seasonRes.error) {
      console.error("[agent/events/draft] season lookup failed", seasonRes.error);
      track500(started_at);
      return NextResponse.json<AgentApiError>(
        { error: "Failed to validate season_id" },
        { status: 500 }
      );
    }
    if (!seasonRes.data) {
      track400(started_at);
      return NextResponse.json<AgentApiError>(
        { error: "Unknown season_id" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from("events")
    .insert({
      title,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      location,
      description,
      images,
      event_type_id: eventTypeId,
      season_id: seasonId,
      visibility,
      // Forced regardless of any value the agent may have sent.
      is_published: false,
      is_confirmed: false,
      registration_enabled: false,
    })
    .select("id")
    .limit(1)
    .single();

  if (error || !data) {
    if (error) console.error("[agent/events/draft] insert failed", error);
    track500(started_at);
    return NextResponse.json<AgentApiError>(
      { error: "Failed to save draft event" },
      { status: 500 }
    );
  }

  // Seed a default "Standard" ticket type so the draft isn't typeless. Prices
  // stay null (a draft has none yet); the admin sets them before enabling
  // registration, which the enable guard enforces. Non-fatal on failure — the
  // draft can't take registrations until a priced type exists either way.
  const { error: ttError } = await supabase
    .from("event_ticket_types")
    .insert({ event_id: data.id, title: "Standard", counts_as_seat: true, sort_order: 0 });
  if (ttError) {
    console.error("[agent/events/draft] seed ticket type failed", { eventId: data.id, ttError });
  }

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "POST",
    status_code: 201,
    started_at,
    extra: { event_id: data.id },
  });
  return NextResponse.json<EventDraftCreatedResponse>(
    {
      event_id: data.id,
      edit_url: "/admin/events",
    },
    { status: 201 }
  );
}
