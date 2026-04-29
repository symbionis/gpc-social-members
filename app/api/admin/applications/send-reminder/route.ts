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

  // Verify admin
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role, is_approval_committee")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || (admin.role !== "super_admin" && !admin.is_approval_committee)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id } = await request.json();

  // Get member info
  const { data: members } = await adminClient
    .from("members")
    .select("id, first_name, last_name, email, status, originator_id")
    .eq("id", member_id)
    .eq("status", "pending")
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json(
      { error: "Member not found or not in pending status" },
      { status: 400 }
    );
  }

  // Look up originator's invite code for the deep link
  const { data: originators } = await adminClient
    .from("admin_users")
    .select("invite_code")
    .eq("id", member.originator_id)
    .limit(1);

  const inviteCode = originators?.[0]?.invite_code;
  if (!inviteCode) {
    return NextResponse.json(
      { error: "Could not resolve originator invite code" },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const resumeUrl = `${appUrl}/apply/${inviteCode}?resume=${member.id}`;

  await sendEmail({
    to: member.email,
    templateAlias: "complete-application",
    templateModel: {
      first_name: member.first_name,
      resume_url: resumeUrl,
      preheader: "Complete your application to the Geneva Polo Club Social Club.",
    },
  });

  await adminClient
    .from("members")
    .update({ last_reminder_sent_at: new Date().toISOString() })
    .eq("id", member_id);

  return NextResponse.json({ success: true });
}
