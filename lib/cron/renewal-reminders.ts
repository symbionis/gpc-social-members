import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

export interface RenewalReminderResult {
  sent: number;
  skipped: number;
  reason?: string;
}

interface ReminderStage {
  days: number;
  sentColumn: "renewal_reminder_1_sent_at" | "renewal_reminder_2_sent_at" | "renewal_reminder_3_sent_at";
  label: string;
}

export async function runRenewalReminders(): Promise<RenewalReminderResult> {
  const supabase = createAdminClient();

  // Check if auto-renewal reminders are enabled
  const { data: settings } = await supabase
    .from("email_settings")
    .select("id, value, enabled")
    .eq("key", "auto_renewal_reminder")
    .limit(1);

  const setting = settings?.[0];

  if (!setting?.enabled) {
    return { sent: 0, skipped: 0, reason: "disabled" };
  }

  const value = setting.value as Record<string, unknown>;

  // Build reminder stages from settings (support legacy single-value format)
  const stages: ReminderStage[] = [];

  if ("reminder_1_days" in value) {
    const r1 = Number(value.reminder_1_days) || 30;
    const r2 = Number(value.reminder_2_days) || 0;
    const r3 = Number(value.reminder_3_days) || 0;
    if (r1 > 0) stages.push({ days: r1, sentColumn: "renewal_reminder_1_sent_at", label: "1st" });
    if (r2 > 0) stages.push({ days: r2, sentColumn: "renewal_reminder_2_sent_at", label: "2nd" });
    if (r3 > 0) stages.push({ days: r3, sentColumn: "renewal_reminder_3_sent_at", label: "3rd" });
  } else {
    // Legacy format: single days_before_expiry
    const days = Number(value.days_before_expiry) || 30;
    stages.push({ days, sentColumn: "renewal_reminder_1_sent_at", label: "1st" });
  }

  if (stages.length === 0) {
    return { sent: 0, skipped: 0, reason: "no stages configured" };
  }

  // Sort stages descending by days (30, 14, 7) so we process earliest first
  stages.sort((a, b) => b.days - a.days);

  const todayStr = new Date().toISOString().slice(0, 10);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let sent = 0;
  let skipped = 0;

  // Find active members with end_date within the widest window
  const widestWindow = stages[0].days;
  const windowDate = new Date();
  windowDate.setDate(windowDate.getDate() + widestWindow);
  const windowDateStr = windowDate.toISOString().slice(0, 10);

  const { data: expiringMembers } = await supabase
    .from("members")
    .select("id, first_name, last_name, email, originator_id, end_date, renewal_reminder_1_sent_at, renewal_reminder_2_sent_at, renewal_reminder_3_sent_at")
    .eq("status", "active")
    .not("end_date", "is", null)
    .gte("end_date", todayStr)
    .lte("end_date", windowDateStr);

  if (!expiringMembers || expiringMembers.length === 0) {
    await updateLastRun(supabase, setting.id, 0, 0);
    return { sent: 0, skipped: 0 };
  }

  for (const member of expiringMembers) {
    if (!member.originator_id) {
      console.warn(`[renewal] Member ${member.id} has no originator_id — skipping`);
      skipped++;
      continue;
    }

    if (!member.end_date) continue;

    const endDate = new Date(member.end_date);
    const today = new Date(todayStr);
    const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Find which stage to send (latest applicable unsent stage)
    let stageToSend: ReminderStage | null = null;
    for (const stage of stages) {
      if (daysUntilExpiry <= stage.days) {
        const alreadySent = member[stage.sentColumn as keyof typeof member];
        if (!alreadySent) {
          stageToSend = stage;
          break;
        }
      }
    }

    if (!stageToSend) {
      skipped++;
      continue;
    }

    // Find or create renewal token
    const { data: existingTokens } = await supabase
      .from("renewal_tokens")
      .select("token")
      .eq("member_id", member.id)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1);

    let token: string;

    if (existingTokens?.[0]) {
      token = existingTokens[0].token;
    } else {
      token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 60);

      const { error: insertError } = await supabase
        .from("renewal_tokens")
        .insert({
          member_id: member.id,
          originator_id: member.originator_id,
          token,
          expires_at: expiresAt.toISOString(),
        });

      if (insertError) {
        console.error(`[renewal] Failed to create token for ${member.id}:`, insertError);
        skipped++;
        continue;
      }
    }

    const expiryDate = new Date(member.end_date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const renewalUrl = `${appUrl}/renew/${token}`;

    const isUrgent = daysUntilExpiry <= 7;

    await sendEmail({
      to: member.email,
      templateAlias: "membership-expiring",
      templateModel: {
        first_name: member.first_name,
        last_name: member.last_name,
        expiry_date: expiryDate,
        renewal_url: renewalUrl,
        is_urgent: isUrgent ? true : null,
        days_remaining: daysUntilExpiry,
        preheader: isUrgent
          ? `Your membership expires in ${daysUntilExpiry} days — renew now to keep your benefits.`
          : `Your membership expires on ${expiryDate}. Renew to continue enjoying club benefits.`,
      },
    });

    // Mark this stage as sent
    await supabase
      .from("members")
      .update({ [stageToSend.sentColumn]: new Date().toISOString() })
      .eq("id", member.id);

    console.log(`[renewal] ${stageToSend.label} reminder sent to ${member.email} (${daysUntilExpiry} days until expiry)`);
    sent++;
  }

  await updateLastRun(supabase, setting.id, sent, skipped);
  console.log(`[renewal] Complete: sent=${sent}, skipped=${skipped}`);
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
