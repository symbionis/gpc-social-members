import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { generateCardNumber } from "@/lib/utils/card";

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

  if (!admins?.[0]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id } = await request.json();

  // Get member's tier_id
  const { data: memberData } = await adminClient
    .from("members")
    .select("tier_id")
    .eq("id", member_id)
    .limit(1);

  const memberTierId = memberData?.[0]?.tier_id || null;

  // Update member to active
  await adminClient
    .from("members")
    .update({ status: "active" })
    .eq("id", member_id);

  // Create free payment record
  const currentYear = new Date().getFullYear().toString();
  await adminClient.from("payments").insert({
    member_id,
    tier_id: memberTierId,
    amount_eur: 0,
    payment_status: "free",
    season: currentYear,
  });

  // Generate card
  const cardNumber = generateCardNumber();
  const today = new Date().toISOString().slice(0, 10);
  const validUntil = `${new Date().getFullYear()}-12-31`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const verifyUrl = `${appUrl}/verify/${cardNumber}`;

  await adminClient.from("membership_cards").insert({
    member_id,
    card_number: cardNumber,
    qr_code_data: verifyUrl,
    tier_id: memberTierId,
    valid_from: today,
    valid_until: validUntil,
    is_active: true,
  });

  return NextResponse.json({ success: true });
}
