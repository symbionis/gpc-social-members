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

  const adminClient = createAdminClient();

  // Verify caller is admin
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .limit(1);

  if (!admins?.[0]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id } = await request.json();

  // Get member and their tier
  const { data: members } = await adminClient
    .from("members")
    .select("id, email, first_name, last_name, tier_id")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Get tier's Stripe price ID
  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("id, name, stripe_price_id, price_eur")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier?.stripe_price_id) {
    return NextResponse.json(
      { error: "Tier has no Stripe price configured" },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Create Stripe Checkout Session
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: member.email,
    line_items: [
      {
        price: tier.stripe_price_id,
        quantity: 1,
      },
    ],
    metadata: {
      member_id: member.id,
    },
    success_url: `${appUrl}/login?payment=success`,
    cancel_url: `${appUrl}/login?payment=cancelled`,
  });

  return NextResponse.json({ checkout_url: session.url });
}
