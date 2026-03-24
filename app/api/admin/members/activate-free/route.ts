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

  // Get current season
  const { data: seasons } = await adminClient
    .from("seasons")
    .select("id, end_date")
    .gte("end_date", new Date().toISOString().slice(0, 10))
    .order("start_date", { ascending: true })
    .limit(1);

  const season = seasons?.[0];

  // Update member to active
  await adminClient
    .from("members")
    .update({ status: "active", payment_status: "free" })
    .eq("id", member_id);

  // Create free payment record
  await adminClient.from("payments").insert({
    member_id,
    season_id: season?.id || null,
    amount_cents: 0,
    status: "free",
  });

  // Generate card
  const cardNumber = generateCardNumber();
  const today = new Date().toISOString().slice(0, 10);
  const validUntil = season?.end_date || `${new Date().getFullYear()}-12-31`;

  await adminClient.from("membership_cards").insert({
    member_id,
    card_number: cardNumber,
    valid_from: today,
    valid_until: validUntil,
    is_active: true,
  });

  return NextResponse.json({ success: true });
}
