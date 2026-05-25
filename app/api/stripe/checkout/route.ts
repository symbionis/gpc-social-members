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

  // Get tier price
  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("id, name, price_eur")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier || tier.price_eur <= 0) {
    return NextResponse.json(
      { error: "Tier has no price configured" },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Create Stripe Checkout Session
  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: member.email,
      line_items: [
        {
          price_data: {
            currency: "chf",
            unit_amount: Math.round(tier.price_eur * 100),
            product_data: { name: tier.name },
          },
          quantity: 1,
        },
      ],
      metadata: {
        member_id: member.id,
      },
      success_url: `${appUrl}/login?payment=success`,
      cancel_url: `${appUrl}/login?payment=cancelled`,
    });
  } catch (err) {
    console.error("[stripe-checkout] Stripe session creation failed:", err);
    return NextResponse.json(
      {
        error: `Could not create the payment session (Stripe: ${
          err instanceof Error ? err.message : "unknown error"
        }).`,
      },
      { status: 502 }
    );
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Failed to create payment session." },
      { status: 502 }
    );
  }

  return NextResponse.json({ checkout_url: session.url });
}
