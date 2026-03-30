import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { generateCardNumber } from "@/lib/utils/card";
import { sendEmail } from "@/lib/postmark";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { token, tier_id } = await request.json();

  if (!token || !tier_id) {
    return NextResponse.json(
      { error: "token and tier_id required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Validate token
  const { data: tokens } = await supabase
    .from("renewal_tokens")
    .select("id, member_id, originator_id, used, expires_at")
    .eq("token", token)
    .limit(1);

  const renewalToken = tokens?.[0];

  if (!renewalToken) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }
  if (renewalToken.used) {
    return NextResponse.json({ error: "Token already used" }, { status: 400 });
  }
  if (new Date(renewalToken.expires_at) < new Date()) {
    return NextResponse.json({ error: "Token expired" }, { status: 400 });
  }

  const memberId = renewalToken.member_id;

  // Fetch tier
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, price_eur, stripe_price_id")
    .eq("id", tier_id)
    .eq("is_active", true)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier) {
    return NextResponse.json({ error: "Tier not found" }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Honorary (free) — activate directly without Stripe
  if (tier.price_eur === 0) {
    const currentYear = new Date().getFullYear().toString();

    // Update member status and tier
    await supabase
      .from("members")
      .update({ status: "active", tier_id })
      .eq("id", memberId);

    // Create free payment record
    await supabase.from("payments").insert({
      member_id: memberId,
      tier_id,
      amount_eur: 0,
      payment_status: "free",
      season: currentYear,
    });

    // Deactivate old cards
    await supabase
      .from("membership_cards")
      .update({ is_active: false })
      .eq("member_id", memberId)
      .eq("is_active", true);

    // Generate new card
    const cardNumber = generateCardNumber();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const validUntilDate = new Date(now);
    validUntilDate.setFullYear(validUntilDate.getFullYear() + 1);
    const validUntil = validUntilDate.toISOString().slice(0, 10);
    const verifyUrl = `${appUrl}/verify/${cardNumber}`;

    const { data: newCards } = await supabase
      .from("membership_cards")
      .insert({
        member_id: memberId,
        card_number: cardNumber,
        qr_code_data: verifyUrl,
        tier_id,
        valid_from: today,
        valid_until: validUntil,
        is_active: true,
      })
      .select("id")
      .limit(1);

    // Mark token used
    await supabase
      .from("renewal_tokens")
      .update({ used: true })
      .eq("id", renewalToken.id);

    // Send payment confirmed email
    fetch(`${appUrl}/api/email/payment-confirmed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      },
      body: JSON.stringify({ member_id: memberId, card_number: cardNumber }),
    }).catch((err) =>
      console.error("Failed to trigger payment confirmation email:", err)
    );

    return NextResponse.json({ success: true, activated: true });
  }

  // Paid tier — create Stripe checkout session
  if (!tier.stripe_price_id) {
    return NextResponse.json(
      { error: "No Stripe price configured for this tier" },
      { status: 400 }
    );
  }

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
    metadata: {
      member_id: memberId,
      renewal: "true",
      renewal_token_id: renewalToken.id,
      tier_id,
    },
    success_url: `${appUrl}/login?payment=success`,
    cancel_url: `${appUrl}/renew/${token}`,
  });

  return NextResponse.json({ checkout_url: session.url });
}
