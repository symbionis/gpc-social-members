import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendReactivationEmail } from "@/lib/members/reactivation";
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
    .select("id, role, is_approval_committee")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isSuper = admin.role === "super_admin";
  const isCommittee = admin.is_approval_committee;
  if (!isSuper && !isCommittee) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const member_id: string | undefined = body.member_id;
  const force: boolean = body.force === true;

  if (!member_id) {
    return NextResponse.json(
      { error: "member_id required" },
      { status: 400 }
    );
  }

  const result = await sendReactivationEmail(member_id, { force });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status }
    );
  }

  return NextResponse.json({ success: true, token: result.token });
}
