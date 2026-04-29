import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendReactivationEmail } from "@/app/api/admin/members/request-reactivation/route";
import { NextResponse, type NextRequest } from "next/server";

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

  if (admins?.[0]?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const force: boolean = body.force === true;

  const { data: expiredMembers } = await adminClient
    .from("members")
    .select("id, email")
    .eq("status", "expired");

  if (!expiredMembers || expiredMembers.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: [] });
  }

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ member_id: string; email: string; code: string; error: string }> = [];

  for (const member of expiredMembers) {
    const result = await sendReactivationEmail(member.id, { force });
    if (result.ok) {
      sent += 1;
    } else if (result.code === "cooldown") {
      skipped += 1;
    } else {
      errors.push({
        member_id: member.id,
        email: member.email,
        code: result.code,
        error: result.error,
      });
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}
