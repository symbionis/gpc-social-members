import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type {
  AgentApiError,
  EventUpdatedResponse,
} from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/events/[id]";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const ALLOWED_VISIBILITIES = ["public", "members_only"] as const;
type Visibility = (typeof ALLOWED_VISIBILITIES)[number];
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isVisibility(v: string): v is Visibility {
  return (ALLOWED_VISIBILITIES as readonly string[]).includes(v);
}

function track(started_at: number, status_code: number, extra?: Record<string, unknown>) {
  trackAgentAction({ endpoint: ENDPOINT, method: "PATCH", status_code, started_at, extra });
}

function bad(started_at: number, error: string) {
  track(started_at, 400);
  return NextResponse.json<AgentApiError>({ error }, { status: 400 });
}

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Agent-facing partial update for an existing event. Accepts any subset of
 * editable fields. The agent cannot toggle `is_published` or `is_confirmed`
 * — those gates stay with admins, mirroring the draft creation endpoint.
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const { id } = await ctx.params;
  if (!id || !UUID.test(id)) return bad(started_at, "Invalid event id");

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const supabase = createAdminClient();

  const current = await supabase
    .from("events")
    .select(
      "id, title, event_type_id, start_date, end_date, start_time, location, description, notes, season_id, images, image_url, image_url_2, visibility, registration_enabled, price_member, price_non_member, seat_cap"
    )
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (current.error) {
    console.error("[agent/events PATCH] lookup failed", current.error);
    track(started_at, 500);
    return NextResponse.json<AgentApiError>(
      { error: "Failed to load event" },
      { status: 500 }
    );
  }
  if (!current.data) {
    track(started_at, 404);
    return NextResponse.json<AgentApiError>(
      { error: "Event not found" },
      { status: 404 }
    );
  }

  const update: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  if ("title" in body) {
    const v = body.title;
    if (typeof v !== "string" || v.trim().length === 0) {
      return bad(started_at, "title must be a non-empty string");
    }
    update.title = v.trim();
    updatedFields.push("title");
  }

  if ("event_type_id" in body) {
    const v = body.event_type_id;
    if (typeof v !== "string" || !UUID.test(v)) {
      return bad(started_at, "event_type_id must be a uuid");
    }
    const r = await supabase
      .from("event_types")
      .select("id")
      .eq("id", v)
      .limit(1)
      .maybeSingle();
    if (r.error) {
      track(started_at, 500);
      return NextResponse.json<AgentApiError>(
        { error: "Failed to validate event_type_id" },
        { status: 500 }
      );
    }
    if (!r.data) return bad(started_at, "Unknown event_type_id");
    update.event_type_id = v;
    updatedFields.push("event_type_id");
  }

  if ("season_id" in body) {
    const v = body.season_id;
    if (v === null) {
      update.season_id = null;
      updatedFields.push("season_id");
    } else if (typeof v === "string" && UUID.test(v)) {
      const r = await supabase
        .from("seasons")
        .select("id")
        .eq("id", v)
        .limit(1)
        .maybeSingle();
      if (r.error) {
        track(started_at, 500);
        return NextResponse.json<AgentApiError>(
          { error: "Failed to validate season_id" },
          { status: 500 }
        );
      }
      if (!r.data) return bad(started_at, "Unknown season_id");
      update.season_id = v;
      updatedFields.push("season_id");
    } else {
      return bad(started_at, "season_id must be a uuid or null");
    }
  }

  if ("start_date" in body) {
    const v = body.start_date;
    if (typeof v !== "string" || !ISO_DATE.test(v)) {
      return bad(started_at, "start_date must be YYYY-MM-DD");
    }
    update.start_date = v;
    updatedFields.push("start_date");
  }

  if ("end_date" in body) {
    const v = body.end_date;
    if (v === null || v === "") {
      update.end_date = null;
      updatedFields.push("end_date");
    } else if (typeof v === "string" && ISO_DATE.test(v)) {
      update.end_date = v;
      updatedFields.push("end_date");
    } else {
      return bad(started_at, "end_date must be YYYY-MM-DD or null");
    }
  }

  if ("start_time" in body) {
    const v = body.start_time;
    if (v === null || v === "") {
      update.start_time = null;
      updatedFields.push("start_time");
    } else if (typeof v === "string" && TIME.test(v)) {
      update.start_time = v;
      updatedFields.push("start_time");
    } else {
      return bad(started_at, "start_time must be HH:MM or HH:MM:SS or null");
    }
  }

  for (const field of ["location", "description", "notes"] as const) {
    if (field in body) {
      const v = body[field];
      if (v === null || v === "") {
        update[field] = null;
        updatedFields.push(field);
      } else if (typeof v === "string") {
        update[field] = v;
        updatedFields.push(field);
      } else {
        return bad(started_at, `${field} must be a string or null`);
      }
    }
  }

  if ("images" in body) {
    const v = body.images;
    if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
      return bad(started_at, "images must be an array of strings");
    }
    const list = v
      .map((s) => (s as string).trim())
      .filter((s): s is string => s.length > 0);
    update.images = list;
    update.image_url = list[0] ?? null;
    update.image_url_2 = list[1] ?? null;
    updatedFields.push("images");
  }

  if ("visibility" in body) {
    const v = body.visibility;
    if (typeof v !== "string" || !isVisibility(v)) {
      return bad(
        started_at,
        `visibility must be one of: ${ALLOWED_VISIBILITIES.join(", ")}`
      );
    }
    update.visibility = v;
    updatedFields.push("visibility");
  }

  if ("registration_enabled" in body) {
    const v = body.registration_enabled;
    if (typeof v !== "boolean") {
      return bad(started_at, "registration_enabled must be a boolean");
    }
    update.registration_enabled = v;
    updatedFields.push("registration_enabled");
  }

  function parsePrice(raw: unknown): number | null | "invalid" {
    if (raw === null || raw === "" || raw === undefined) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return "invalid";
  }

  if ("price_member" in body) {
    const p = parsePrice(body.price_member);
    if (p === "invalid") return bad(started_at, "price_member must be a number or null");
    if (p !== null && p < 0) return bad(started_at, "price_member cannot be negative");
    update.price_member = p;
    updatedFields.push("price_member");
  }
  if ("price_non_member" in body) {
    const p = parsePrice(body.price_non_member);
    if (p === "invalid") return bad(started_at, "price_non_member must be a number or null");
    if (p !== null && p < 0) return bad(started_at, "price_non_member cannot be negative");
    update.price_non_member = p;
    updatedFields.push("price_non_member");
  }
  if ("seat_cap" in body) {
    const raw = body.seat_cap;
    if (raw === null || raw === "" || raw === undefined) {
      update.seat_cap = null;
    } else {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return bad(started_at, "seat_cap must be a positive integer or null");
      }
      update.seat_cap = n;
    }
    updatedFields.push("seat_cap");
  }

  if (updatedFields.length === 0) {
    return bad(started_at, "No editable fields provided");
  }

  // Cross-field validation against the merged (current + update) state.
  const merged = { ...current.data, ...update };
  if ("end_date" in merged && merged.end_date && merged.start_date && merged.end_date < merged.start_date) {
    return bad(started_at, "end_date must be on or after start_date");
  }
  const mergedVisibility = merged.visibility === "public" ? "public" : "members_only";
  const isMembersOnly = mergedVisibility === "members_only";

  // Force price_non_member to null for members_only events, mirroring the
  // admin update route. Otherwise an old non-member price would persist on
  // an event that's now members-only.
  if (isMembersOnly && merged.price_non_member !== null) {
    update.price_non_member = null;
    if (!updatedFields.includes("price_non_member")) updatedFields.push("price_non_member");
    merged.price_non_member = null;
  }

  if (merged.registration_enabled) {
    if (merged.price_member === null || Number.isNaN(Number(merged.price_member))) {
      return bad(
        started_at,
        "price_member is required when registration_enabled is true"
      );
    }
    if (!isMembersOnly && (merged.price_non_member === null || Number.isNaN(Number(merged.price_non_member)))) {
      return bad(
        started_at,
        "price_non_member is required for public events when registration_enabled is true"
      );
    }
  }

  const { error } = await supabase.from("events").update(update).eq("id", id);
  if (error) {
    console.error("[agent/events PATCH] update failed", error);
    track(started_at, 500);
    return NextResponse.json<AgentApiError>(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }

  track(started_at, 200, { event_id: id, fields: updatedFields });
  return NextResponse.json<EventUpdatedResponse>({
    event_id: id,
    updated_fields: updatedFields,
  });
}
