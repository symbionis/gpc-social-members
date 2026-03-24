import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { NextResponse, type NextRequest } from "next/server";

// Called internally from Stripe webhook — no auth required (internal only)
export async function POST(request: NextRequest) {
  // Verify internal call via secret header
  const secret = request.headers.get("x-internal-secret");
  if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, card_number } = await request.json();

  const supabase = createAdminClient();

  const { data: members } = await supabase
    .from("members")
    .select("email, first_name, last_name, tier_id, member_number")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("name")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  await sendEmail({
    to: member.email,
    templateAlias: "payment-confirmed",
    templateModel: {
      first_name: member.first_name,
      last_name: member.last_name,
      tier_name: tier?.name || "Member",
      card_number: card_number,
      member_number: member.member_number || "",
      portal_url: `${appUrl}/login`,
    },
  });

  return NextResponse.json({ success: true });
}
