import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { getStripe } from "@/lib/stripe";

export interface PaymentReminderResult {
  sent: number;
  skipped: number;
  reason?: string;
}

export async function runPaymentReminders(): Promise<PaymentReminderResult> {
  const supabase = createAdminClient();

  // Check if payment reminders are enabled
  const { data: settings } = await supabase
    .from("email_settings")
    .select("id, value, enabled")
    .eq("key", "payment_reminder")
    .limit(1);

  const setting = settings?.[0];

  if (!setting?.enabled) {
    return { sent: 0, skipped: 0, reason: "disabled" };
  }

  const daysAfterApproval =
    (setting.value as { days_after_approval?: number })?.days_after_approval ?? 3;

  // Find members who were approved more than X days ago but haven't paid
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAfterApproval);
  const cutoffDateStr = cutoffDate.toISOString();

  const { data: members } = await supabase
    .from("members")
    .select("id, first_name, last_name, email, tier_id")
    .eq("status", "approved")
    .lt("approved_at", cutoffDateStr);

  if (!members || members.length === 0) {
    await updateLastRun(supabase, setting.id, 0, 0);
    return { sent: 0, skipped: 0 };
  }

  // Skip members on the new capture flow (they have payment_capture_status set)
  const memberIds = members.map((m) => m.id);
  const { data: capturePayments } = await supabase
    .from("payments")
    .select("member_id")
    .in("member_id", memberIds)
    .not("payment_capture_status", "is", null);

  const captureFlowMemberIds = new Set(
    (capturePayments || []).map((p) => p.member_id)
  );
  const legacyMembers = members.filter((m) => !captureFlowMemberIds.has(m.id));

  if (legacyMembers.length === 0) {
    await updateLastRun(supabase, setting.id, 0, members.length);
    return { sent: 0, skipped: members.length, reason: "all on new capture flow" };
  }

  // Collect unique tier IDs and fetch tiers
  // Use legacyMembers from here on
  const tierIds = [...new Set(legacyMembers.map((m) => m.tier_id).filter(Boolean))];

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, price_eur")
    .in("id", tierIds);

  const tierMap = new Map(
    (tiers || []).map((t) => [t.id, t])
  );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  let sent = 0;
  let skipped = 0;

  for (const member of legacyMembers) {
    const tier = tierMap.get(member.tier_id);

    if (!tier || tier.price_eur <= 0) {
      console.warn(
        `Member ${member.id} has no payable tier (tier_id=${member.tier_id}) — skipping`
      );
      skipped++;
      continue;
    }

    try {
      const session = await getStripe().checkout.sessions.create({
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
        metadata: { member_id: member.id },
        success_url: `${appUrl}/login?payment=success`,
        cancel_url: `${appUrl}/login?payment=cancelled`,
      });

      const checkoutUrl = session.url || "";

      await sendEmail({
        to: member.email,
        templateAlias: "payment-reminder",
        templateModel: {
          first_name: member.first_name,
          last_name: member.last_name,
          tier_name: tier.name,
          checkout_url: checkoutUrl,
          preheader: "Complete your membership payment",
        },
      });

      sent++;
    } catch (error) {
      console.error(
        `Failed to process payment reminder for member ${member.id}:`,
        error
      );
      skipped++;
    }
  }

  await updateLastRun(supabase, setting.id, sent, skipped);
  console.log(`Payment reminders: sent=${sent}, skipped=${skipped}`);
  return { sent, skipped };
}

async function updateLastRun(
  supabase: ReturnType<typeof createAdminClient>,
  settingId: string,
  sent: number,
  skipped: number
) {
  const currentValue = (
    await supabase
      .from("email_settings")
      .select("value")
      .eq("id", settingId)
      .limit(1)
  ).data?.[0]?.value as Record<string, unknown> | undefined;

  await supabase
    .from("email_settings")
    .update({
      value: {
        ...currentValue,
        last_run: new Date().toISOString(),
        last_result: { sent, skipped },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", settingId);
}
