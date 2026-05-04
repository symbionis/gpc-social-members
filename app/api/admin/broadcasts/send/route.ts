import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBroadcast } from "@/lib/broadcast/send";
import type { AudienceFilter } from "@/lib/broadcast/types";
import type { MemberStatus } from "@/types/database";
import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_STATUSES: Array<MemberStatus | "all"> = [
  "all",
  "active",
  "expired",
];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || admin.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const subject: string = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyHtml: string =
    typeof body.body_html === "string" ? body.body_html : "";
  const filterRaw = body.audience_filter ?? {};
  const status = filterRaw.status as MemberStatus | "all";
  const tierIds: string[] = Array.isArray(filterRaw.tier_ids)
    ? filterRaw.tier_ids.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0
      )
    : typeof filterRaw.tier_id === "string" && filterRaw.tier_id.length > 0
      ? [filterRaw.tier_id]
      : [];

  if (!subject) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (!bodyHtml || bodyHtml.replace(/<[^>]+>/g, "").trim().length === 0) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid audience.status (allowed: ${ALLOWED_STATUSES.join(", ")})` },
      { status: 400 }
    );
  }

  const filter: AudienceFilter = { status, tier_ids: tierIds };

  try {
    const result = await sendBroadcast({
      subject,
      body_html: bodyHtml,
      audience_filter: filter,
      channel: "email",
      created_by: admin.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[broadcasts/send] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
