import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const member_id = typeof body.member_id === "string" ? body.member_id : null;

  if (!member_id) {
    return NextResponse.json(
      { error: "member_id is required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Check for an existing payment row for this member (prevents duplicate rows on retry)
  const { data: existingPayments } = await supabase
    .from("payments")
    .select("id, stripe_payment_intent_id, payment_capture_status")
    .eq("member_id", member_id)
    .not("payment_capture_status", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const existingPayment = existingPayments?.[0];
  if (existingPayment?.stripe_payment_intent_id) {
    // Return existing PI's client secret instead of creating a duplicate
    try {
      const existingPI = await getStripe().paymentIntents.retrieve(
        existingPayment.stripe_payment_intent_id
      );
      if (existingPI.client_secret && existingPI.status !== "canceled") {
        return NextResponse.json({ clientSecret: existingPI.client_secret });
      }
    } catch {
      // PI may have been cleaned up — proceed to create new one
    }
  }

  // Look up member and tier
  const { data: members } = await supabase
    .from("members")
    .select("id, email, first_name, last_name, tier_id, status, stripe_customer_id")
    .eq("id", member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 400 });
  }

  if (member.status !== "pending") {
    return NextResponse.json(
      { error: "Member is not in pending status" },
      { status: 400 }
    );
  }

  // Get tier pricing
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, slug, price_eur")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier) {
    return NextResponse.json({ error: "Tier not found" }, { status: 400 });
  }

  const stripe = getStripe();
  const amountInCentimes = Math.round(tier.price_eur * 100);

  try {
    // Create or reuse Stripe Customer
    let customerId = member.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: member.email,
        name: `${member.first_name} ${member.last_name}`,
        metadata: { member_id: member.id },
      });
      customerId = customer.id;

      await supabase
        .from("members")
        .update({ stripe_customer_id: customerId })
        .eq("id", member.id);
    }

    // Create PaymentIntent with manual capture + save card for off-session fallback
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCentimes,
        currency: "chf",
        customer: customerId,
        capture_method: "manual",
        setup_future_usage: "off_session",
        metadata: {
          member_id: member.id,
          tier_slug: tier.slug,
        },
      },
      {
        idempotencyKey: `pi_create_${member.id}`,
      }
    );

    // Insert payments row to track lifecycle from creation
    await supabase.from("payments").insert({
      member_id: member.id,
      tier_id: tier.id,
      amount_eur: tier.price_eur,
      currency: "CHF",
      payment_status: "pending",
      payment_capture_status: "pending",
      stripe_payment_intent_id: paymentIntent.id,
      season: new Date().getFullYear().toString(),
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("[create-payment-intent] Stripe error:", err);
    return NextResponse.json(
      { error: "Failed to create payment intent" },
      { status: 500 }
    );
  }
}
