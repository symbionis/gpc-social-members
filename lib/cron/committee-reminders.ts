import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

export interface CommitteeReminderResult {
  sent: number;
  skipped: number;
  holdExpiredCaught: number;
  reason?: string;
}

export async function runCommitteeReminders(): Promise<CommitteeReminderResult> {
  const supabase = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Get committee members
  const { data: committee } = await supabase
    .from("admin_users")
    .select("email, first_name")
    .or("is_approval_committee.eq.true,role.eq.super_admin");

  if (!committee?.length) {
    return { sent: 0, skipped: 0, holdExpiredCaught: 0, reason: "no committee members" };
  }

  // Get all authorized payments with their member info
  const { data: payments } = await supabase
    .from("payments")
    .select("id, member_id, authorized_at, capture_before, reminder_day1_sent, reminder_day3_sent, reminder_day4_sent")
    .eq("payment_capture_status", "authorized");

  if (!payments?.length) {
    return { sent: 0, skipped: 0, holdExpiredCaught: 0 };
  }

  const now = Date.now();
  let sent = 0;
  let skipped = 0;

  for (const payment of payments) {
    if (!payment.authorized_at || !payment.capture_before) {
      skipped++;
      continue;
    }

    const authorizedAt = new Date(payment.authorized_at).getTime();
    const captureBefore = new Date(payment.capture_before).getTime();
    const totalWindow = captureBefore - authorizedAt;
    const elapsed = now - authorizedAt;

    // Calculate thresholds relative to actual capture_before
    const day1Threshold = totalWindow * 0.2;   // ~20% of window (~24h for 5-day)
    const day3Threshold = totalWindow * 0.6;   // ~60% of window (~72h for 5-day)
    const day4Threshold = totalWindow * 0.8;   // ~80% of window (~96h for 5-day)

    // Get member info
    const { data: memberData } = await supabase
      .from("members")
      .select("first_name, last_name, email, company_name, company_role")
      .eq("id", payment.member_id)
      .limit(1);

    const member = memberData?.[0];
    if (!member) { skipped++; continue; }

    const applicantName = `${member.first_name} ${member.last_name}`;
    const adminUrl = `${appUrl}/admin/applications`;
    const hoursRemaining = Math.max(0, Math.round((captureBefore - now) / (1000 * 60 * 60)));
    const daysRemaining = Math.max(0, Math.round(hoursRemaining / 24));

    type ReminderFlag = "reminder_day1_sent" | "reminder_day3_sent" | "reminder_day4_sent";
    type ReminderLevel = { flag: ReminderFlag; isReminder: boolean; isUrgent: boolean; subject: string };

    // Collect all unsent reminders that are due — send each independently
    // so a missed cron run doesn't cause earlier reminders to be skipped
    const remindersToSend: ReminderLevel[] = [];

    if (elapsed >= day1Threshold && !payment.reminder_day1_sent) {
      remindersToSend.push({
        flag: "reminder_day1_sent",
        isReminder: true,
        isUrgent: false,
        subject: `Reminder: Application from ${applicantName} — ${daysRemaining} days remaining`,
      });
    }
    if (elapsed >= day3Threshold && !payment.reminder_day3_sent) {
      remindersToSend.push({
        flag: "reminder_day3_sent",
        isReminder: true,
        isUrgent: false,
        subject: `Reminder: Application from ${applicantName} — ${daysRemaining} days remaining`,
      });
    }
    if (elapsed >= day4Threshold && !payment.reminder_day4_sent) {
      remindersToSend.push({
        flag: "reminder_day4_sent",
        isReminder: true,
        isUrgent: true,
        subject: `URGENT: Application from ${applicantName} expires tomorrow`,
      });
    }

    if (remindersToSend.length === 0) {
      skipped++;
      continue;
    }

    // Send only the highest-priority unsent reminder to avoid flooding,
    // but mark all lower flags as sent so they aren't retried
    const reminderToSend = remindersToSend[remindersToSend.length - 1];
    const flagsToSet: Record<string, boolean> = {};
    for (const r of remindersToSend) {
      flagsToSet[r.flag] = true;
    }

    // Reuse new-application-pending template with conditional variables:
    // - is_reminder: truthy → shows "Reminder — X days remaining" line
    // - is_urgent: truthy → shows "URGENT — expires in X hours" line
    // - neither set (initial notification from webhook) → shows default "new application" text
    const results = await Promise.all(
      committee.map((admin) =>
        sendEmail({
          to: admin.email,
          templateAlias: "new-application-pending",
          templateModel: {
            recipient_first_name: admin.first_name,
            applicant_name: applicantName,
            applicant_email: member.email,
            applicant_company: "—",
            applicant_role: "—",
            originator_note: null,
            is_reminder: reminderToSend.isReminder || null,
            is_urgent: reminderToSend.isUrgent || null,
            days_remaining: daysRemaining,
            hours_remaining: hoursRemaining,
            admin_url: adminUrl,
            preheader: reminderToSend.subject,
          },
        }).catch((err) => {
          console.error(`[committee-reminders] Email to ${admin.email} failed:`, err);
          return { success: false };
        })
      )
    );

    const succeeded = results.filter((r) => (r as { success: boolean }).success).length;
    if (succeeded > 0) {
      // Set all due reminder flags (prevents re-sending skipped lower-priority ones)
      await supabase
        .from("payments")
        .update(flagsToSet)
        .eq("id", payment.id);
      sent++;
    } else {
      skipped++;
    }
  }

  return { sent, skipped, holdExpiredCaught: 0 };
}

export async function runHoldExpirySafetyNet(): Promise<{ caught: number }> {
  const supabase = createAdminClient();

  // Find authorized payments past their capture_before
  const { data: stalePayments } = await supabase
    .from("payments")
    .select("id, stripe_payment_intent_id, member_id, capture_before")
    .eq("payment_capture_status", "authorized")
    .lt("capture_before", new Date().toISOString());

  if (!stalePayments?.length) {
    return { caught: 0 };
  }

  for (const payment of stalePayments) {
    console.warn(
      `[hold-expiry-safety] Transitioning payment ${payment.id} (PI: ${payment.stripe_payment_intent_id}) to hold_expired — webhook was missed`
    );

    // Only transition if still authorized — avoids overwriting 'cancelled' from a concurrent decline
    await supabase
      .from("payments")
      .update({ payment_capture_status: "hold_expired" })
      .eq("id", payment.id)
      .eq("payment_capture_status", "authorized");
  }

  return { caught: stalePayments.length };
}
