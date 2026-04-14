import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { generateCardNumber } from "@/lib/utils/card";
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
  if (!admin || (admin.role !== "super_admin" && !admin.is_approval_committee)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id } = await request.json();

  // Get member
  const { data: members } = await adminClient
    .from("members")
    .select("id, email, first_name, last_name, status")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "expired") {
    return NextResponse.json(
      { error: "Member not found or not in expired status" },
      { status: 400 }
    );
  }

  // Get honorary tier (explicit name match for deterministic selection)
  const { data: honoraryTiers } = await adminClient
    .from("membership_tiers")
    .select("id, name")
    .eq("name", "Honorary Member")
    .eq("is_active", true)
    .limit(1);

  const honoraryTier = honoraryTiers?.[0];
  if (!honoraryTier) {
    return NextResponse.json(
      { error: "No honorary tier found" },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now);
  endDate.setFullYear(endDate.getFullYear() + 1);
  const endDateStr = endDate.toISOString().slice(0, 10);

  // Activate member with honorary tier
  await adminClient
    .from("members")
    .update({
      status: "active",
      tier_id: honoraryTier.id,
      start_date: startDate,
      end_date: endDateStr,
      renewal_reminder_1_sent_at: null,
      renewal_reminder_2_sent_at: null,
      renewal_reminder_3_sent_at: null,
    })
    .eq("id", member_id);

  // Create free payment record
  await adminClient.from("payments").insert({
    member_id,
    tier_id: honoraryTier.id,
    amount_eur: 0,
    payment_status: "free",
    season: now.getFullYear().toString(),
  });

  // Generate card
  const cardNumber = generateCardNumber();
  const verifyUrl = `${appUrl}/verify/${cardNumber}`;

  const { data: newCards } = await adminClient
    .from("membership_cards")
    .insert({
      member_id,
      card_number: cardNumber,
      qr_code_data: verifyUrl,
      tier_id: honoraryTier.id,
      valid_from: startDate,
      valid_until: endDateStr,
      is_active: true,
    })
    .select("id")
    .limit(1);

  // Deactivate old cards
  if (newCards?.[0]?.id) {
    await adminClient
      .from("membership_cards")
      .update({ is_active: false })
      .eq("member_id", member_id)
      .neq("id", newCards[0].id)
      .eq("is_active", true);
  }

  // Send member-approved email with card
  await sendEmail({
    to: member.email,
    templateAlias: "member-approved",
    templateModel: {
      first_name: member.first_name,
      last_name: member.last_name,
      tier_name: honoraryTier.name,
      has_card: true,
      card_number: cardNumber,
      portal_url: `${appUrl}/login`,
      checkout_url: null,
      has_payment: null,
      dashboard_url: null,
      preheader: "Your membership is now active. Welcome to the Geneva Polo Club!",
    },
  }).catch((err) =>
    console.error("[renew-honorary] member-approved email failed:", err)
  );

  return NextResponse.json({ success: true });
}
