import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/broadcast/auth";
import { parseBroadcastPayload } from "@/lib/broadcast/validate";
import { NextResponse, type NextRequest } from "next/server";

/** List all drafts (most-recently-updated first). */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select(
      "id, subject, body_html, audience_filter, channel, status, created_at, created_by"
    )
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ drafts: data ?? [] });
}

/** Create a new draft. Subject and body may be empty (drafts are partial). */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = parseBroadcastPayload(body, { forDraft: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({
      subject: parsed.payload.subject,
      body_html: parsed.payload.body_html,
      audience_filter: parsed.payload.audience_filter as unknown as Record<
        string,
        unknown
      >,
      channel: "email",
      status: "draft",
      created_by: auth.admin.id,
    })
    .select("id")
    .limit(1)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save draft" },
      { status: 500 }
    );
  }

  return NextResponse.json({ broadcast_id: data.id });
}
