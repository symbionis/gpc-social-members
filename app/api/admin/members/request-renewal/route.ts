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

  const { member_id, originator_id } = await request.json();

  if (!member_id || !originator_id) {
    return NextResponse.json(
      { error: "member_id and originator_id required" },
      { status: 400 }
    );
  }

  // Validate member exists
  const { data: members } = await adminClient
    .from("members")
    .select("id, first_name, last_name, email, status")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Validate originator exists and link is active
  const { data: originators } = await adminClient
    .from("admin_users")
    .select("id, invite_link_active, can_invite_honorary")
    .eq("id", originator_id)
    .eq("is_originator", true)
    .limit(1);

  const originator = originators?.[0];
  if (!originator || !originator.invite_link_active) {
    return NextResponse.json(
      { error: "Originator not found or invite link inactive" },
      { status: 400 }
    );
  }

  // Generate token and insert
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { error: insertError } = await adminClient
    .from("renewal_tokens")
    .insert({
      member_id,
      originator_id,
      token,
      expires_at: expiresAt.toISOString(),
    });

  if (insertError) {
    console.error("Failed to insert renewal token:", insertError);
    return NextResponse.json(
      { error: "Failed to create renewal token" },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const renewalUrl = `${appUrl}/renew/${token}`;

  await sendEmail({
    to: member.email,
    templateAlias: "membership-renewal",
    templateModel: {
      first_name: member.first_name,
      last_name: member.last_name,
      renewal_url: renewalUrl,
    },
  });

  return NextResponse.json({ success: true, token });
}
