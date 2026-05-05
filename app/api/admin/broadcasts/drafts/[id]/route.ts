import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/broadcast/auth";
import { parseBroadcastPayload } from "@/lib/broadcast/validate";
import { NextResponse, type NextRequest } from "next/server";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }
  const { id } = await ctx.params;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select(
      "id, subject, body_html, audience_filter, channel, status, created_at"
    )
    .eq("id", id)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  return NextResponse.json({ draft: data });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  const parsed = parseBroadcastPayload(body, { forDraft: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Guard against editing rows that have already been sent — once a row
  // leaves 'draft' it is an audit record, not a composer state.
  const { data: updated, error } = await supabase
    .from("broadcasts")
    .update({
      subject: parsed.payload.subject,
      body_html: parsed.payload.body_html,
      audience_filter: parsed.payload.audience_filter as unknown as Record<
        string,
        unknown
      >,
    })
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Draft not found or already sent" },
      { status: 404 }
    );
  }
  return NextResponse.json({ broadcast_id: updated.id });
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }
  const { id } = await ctx.params;

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from("broadcasts")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("status", "draft");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json(
      { error: "Draft not found or already sent" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
