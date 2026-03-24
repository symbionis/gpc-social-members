import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { stripe } from "@/lib/stripe";
import { NextResponse, type NextRequest } from "next/server";

// Send welcome email with Stripe checkout link after approval
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
    .select("id")
    .eq("email", user.email)
    .limit(1);

  if (!admins?.[0]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id } = await request.json();

  // Get member + tier
  const { data: members } = await adminClient
    .from("members")
    .select("id, email, first_name, last_name, tier_id")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("name, stripe_price_id, price_eur")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  let checkoutUrl = "";

  // Create Stripe checkout session if tier has a price
  if (tier?.stripe_price_id && tier.price_eur > 0) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: member.email,
      line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
      metadata: { member_id: member.id },
      success_url: `${appUrl}/login?payment=success`,
      cancel_url: `${appUrl}/login?payment=cancelled`,
    });
    checkoutUrl = session.url || "";
  }

  await sendEmail({
    to: member.email,
    templateAlias: "member-approved",
    templateModel: {
      first_name: member.first_name,
      last_name: member.last_name,
      tier_name: tier?.name || "Member",
      checkout_url: checkoutUrl,
      has_payment: !!checkoutUrl,
    },
  });

  return NextResponse.json({ success: true, checkout_url: checkoutUrl });
}
