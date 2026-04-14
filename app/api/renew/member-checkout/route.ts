import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { member_id, tier_id } = await request.json();

  if (!member_id || !tier_id) {
    return NextResponse.json(
      { error: "member_id and tier_id are required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Verify the authenticated user matches the member
  const { data: members } = await adminClient
    .from("members")
    .select("id, email, first_name, last_name, status")
    .eq("id", member_id)
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "expired") {
    return NextResponse.json(
      { error: "Not eligible for renewal" },
      { status: 400 }
    );
  }

  // Fetch tier
  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("id, name, price_eur, stripe_price_id")
    .eq("id", tier_id)
    .eq("is_active", true)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier || !tier.stripe_price_id) {
    return NextResponse.json(
      { error: "Tier not found or not configured for payment" },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: member.email,
    line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
    metadata: {
      member_id: member.id,
      renewal: "true",
      tier_id: tier.id,
    },
    success_url: `${appUrl}/login?payment=success`,
    cancel_url: `${appUrl}/renew`,
  });

  return NextResponse.json({ checkout_url: session.url });
}
