import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

export interface ExpireMembershipsResult {
  expired: number;
  emailed: number;
}

export async function runExpireMemberships(): Promise<ExpireMembershipsResult> {
  const supabase = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const today = new Date().toISOString().slice(0, 10);

  // Find active members whose end_date has passed
  const { data: expiredMembers, error } = await supabase
    .from("members")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("end_date", today)
    .not("end_date", "is", null)
    .select("id, email, first_name, last_name, end_date");

  if (error) {
    console.error("[expire-memberships] Failed:", error);
    return { expired: 0, emailed: 0 };
  }

  const count = expiredMembers?.length || 0;
  let emailed = 0;

  if (count > 0) {
    const memberIds = expiredMembers!.map((m) => m.id);

    // Deactivate their cards
    await supabase
      .from("membership_cards")
      .update({ is_active: false })
      .in("member_id", memberIds)
      .eq("is_active", true);

    // Reset renewal reminder tracking for next cycle
    await supabase
      .from("members")
      .update({
        renewal_reminder_1_sent_at: null,
        renewal_reminder_2_sent_at: null,
        renewal_reminder_3_sent_at: null,
      })
      .in("id", memberIds);

    // Check if expiry notification emails are enabled
    const { data: expirySetting } = await supabase
      .from("email_settings")
      .select("enabled")
      .eq("key", "auto_expiry_notification")
      .limit(1);

    const expiryEmailEnabled = expirySetting?.[0]?.enabled ?? true;

    // Send expiry email to each member
    for (const m of expiredMembers!) {
      if (!expiryEmailEnabled) break;
      const expiryDate = new Date(m.end_date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      const { success } = await sendEmail({
        to: m.email,
        templateAlias: "membership-expired",
        templateModel: {
          first_name: m.first_name,
          expiry_date: expiryDate,
          portal_url: `${appUrl}/login`,
          preheader: "Your membership has expired. Renew anytime to rejoin the club.",
        },
      });

      if (success) emailed++;
    }

    console.log(
      `[expire-memberships] Expired ${count} members, emailed ${emailed}:`,
      expiredMembers!.map((m) => `${m.first_name} ${m.last_name} (${m.email})`)
    );
  }

  return { expired: count, emailed };
}
