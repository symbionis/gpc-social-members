import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { token, member_id } = await request.json();

  if (!token || !member_id) {
    return NextResponse.json(
      { error: "token and member_id are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Validate token
  const { data: tokens } = await supabase
    .from("payment_retry_tokens")
    .select("id, member_id, payment_id, used, expires_at")
    .eq("token", token)
    .eq("member_id", member_id)
    .limit(1);

  const retryToken = tokens?.[0];

  if (!retryToken) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  if (retryToken.used) {
    return NextResponse.json(
      { error: "This payment link has already been used" },
      { status: 400 }
    );
  }

  if (new Date(retryToken.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This payment link has expired" },
      { status: 400 }
    );
  }

  // Get member and tier info
  const { data: members } = await supabase
    .from("members")
    .select("id, stripe_customer_id, tier_id")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 400 });
  }

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("price_eur, slug")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier) {
    return NextResponse.json({ error: "Tier not found" }, { status: 400 });
  }

  const stripe = getStripe();
  const amountInCentimes = Math.round(tier.price_eur * 100);

  try {
    // Create a new immediate-charge PaymentIntent (no manual capture — already approved)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCentimes,
      currency: "chf",
      customer: member.stripe_customer_id || undefined,
      metadata: {
        member_id: member.id,
        tier_slug: tier.slug,
        retry_token_id: retryToken.id,
      },
    });

    // Update existing payment record with new PI
    await supabase
      .from("payments")
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_capture_status: "pending",
      })
      .eq("id", retryToken.payment_id);

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("[retry-payment] Stripe error:", err);
    return NextResponse.json(
      { error: "Failed to create payment" },
      { status: 500 }
    );
  }
}
