"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export async function createRenewalCheckoutSession(): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) return { error: "Unauthorized" };

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select("id, email, first_name, last_name, tier_id, status")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "expired") return { error: "Not eligible for renewal" };

  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("stripe_price_id")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier?.stripe_price_id) return { error: "No payment configured for your tier" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: member.email,
    line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
    metadata: { member_id: member.id, renewal: "true" },
    success_url: `${appUrl}/login?payment=success`,
    cancel_url: `${appUrl}/dashboard?payment=cancelled`,
  });

  if (!session.url) return { error: "Failed to create payment session" };

  return { url: session.url };
}

export async function createMemberCheckoutSession(): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) return { error: "Unauthorized" };

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select("id, email, first_name, last_name, tier_id, status")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "approved") return { error: "Not eligible for payment" };

  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("stripe_price_id")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];
  if (!tier?.stripe_price_id) return { error: "No payment configured for your tier" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: member.email,
    line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
    metadata: { member_id: member.id },
    success_url: `${appUrl}/login?payment=success`,
    cancel_url: `${appUrl}/dashboard?payment=cancelled`,
  });

  if (!session.url) return { error: "Failed to create payment session" };

  return { url: session.url };
}
