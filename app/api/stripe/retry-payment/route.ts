import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = typeof body.token === "string" ? body.token : null;
  const member_id = typeof body.member_id === "string" ? body.member_id : null;

  if (!token || !member_id) {
    return NextResponse.json(
      { error: "token and member_id are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Atomically claim the token (compare-and-swap: used=false → used=true)
  const { data: claimed, error: claimError } = await supabase
    .from("payment_retry_tokens")
    .update({ used: true })
    .eq("token", token)
    .eq("member_id", member_id)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .select("id, member_id, payment_id")
    .limit(1);

  if (claimError || !claimed?.length) {
    return NextResponse.json(
      { error: "This payment link is invalid, expired, or has already been used." },
      { status: 400 }
    );
  }

  const retryToken = claimed[0];

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
    // Create a new immediate-charge PaymentIntent with idempotency key
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCentimes,
        currency: "chf",
        customer: member.stripe_customer_id || undefined,
        metadata: {
          member_id: member.id,
          tier_slug: tier.slug,
          retry_token_id: retryToken.id,
        },
      },
      { idempotencyKey: `pi_retry_${retryToken.id}` }
    );

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
    // Revert token so user can retry
    await supabase
      .from("payment_retry_tokens")
      .update({ used: false })
      .eq("id", retryToken.id);

    console.error("[retry-payment] Stripe error:", err);
    return NextResponse.json(
      { error: "Failed to create payment" },
      { status: 500 }
    );
  }
}
