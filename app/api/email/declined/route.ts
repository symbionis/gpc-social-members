import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
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
    .select("id")
    .eq("email", user.email)
    .limit(1);

  if (!admins?.[0]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, notes } = await request.json();

  const { data: members } = await adminClient
    .from("members")
    .select("email, first_name, last_name")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await sendEmail({
    to: member.email,
    templateAlias: "application-declined",
    templateModel: {
      first_name: member.first_name,
      last_name: member.last_name,
      notes: notes || "",
    },
  });

  return NextResponse.json({ success: true });
}
