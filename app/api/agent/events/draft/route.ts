import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";

const ENDPOINT = "/api/agent/events/draft";

function track400(started_at: number) {
  trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 400, started_at });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const ALLOWED_VISIBILITY = new Set(["public", "members_only"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
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
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!startDate || !ISO_DATE.test(startDate)) {
    track400(started_at);
    return NextResponse.json(
      { error: "start_date is required and must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (!eventTypeId) {
    track400(started_at);
    return NextResponse.json(
      { error: "event_type_id is required" },
      { status: 400 }
    );
  }

  const endDate = asString(body.end_date);
  if (endDate && !ISO_DATE.test(endDate)) {
    track400(started_at);
    return NextResponse.json(
      { error: "end_date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (endDate && endDate < startDate) {
    track400(started_at);
    return NextResponse.json(
      { error: "end_date must be on or after start_date" },
      { status: 400 }
    );
  }

  const startTime = asString(body.start_time);
  if (startTime && !TIME.test(startTime)) {
    track400(started_at);
    return NextResponse.json(
      { error: "start_time must be HH:MM or HH:MM:SS" },
      { status: 400 }
    );
  }

  const visibility = asString(body.visibility) ?? "public";
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    track400(started_at);
    return NextResponse.json(
      { error: `visibility must be one of: ${[...ALLOWED_VISIBILITY].join(", ")}` },
      { status: 400 }
    );
  }

  const seasonId = asString(body.season_id);
  const location = asString(body.location);
  const description = asString(body.description);
  const images = asStringArray(body.images);

  const supabase = createAdminClient();

  // Validate referenced FKs early so the agent gets a friendly error
  // instead of a Postgres FK violation 500.
  const { data: typeRow } = await supabase
    .from("event_types")
    .select("id")
    .eq("id", eventTypeId)
    .limit(1)
    .maybeSingle();
  if (!typeRow) {
    track400(started_at);
    return NextResponse.json(
      { error: "Unknown event_type_id" },
      { status: 400 }
    );
  }
  if (seasonId) {
    const { data: seasonRow } = await supabase
      .from("seasons")
      .select("id")
      .eq("id", seasonId)
      .limit(1)
      .maybeSingle();
    if (!seasonRow) {
      track400(started_at);
      return NextResponse.json(
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
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 500, started_at });
    return NextResponse.json(
      { error: error?.message ?? "Failed to save draft event" },
      { status: 500 }
    );
  }

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "POST",
    status_code: 201,
    started_at,
    extra: { event_id: data.id },
  });
  return NextResponse.json(
    {
      event_id: data.id,
      edit_url: "/admin/events",
    },
    { status: 201 }
  );
}
