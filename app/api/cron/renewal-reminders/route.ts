import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { NextResponse, type NextRequest } from "next/server";

// Called by Railway Cron (or any cron service) on a schedule.
// Secure with CRON_SECRET header: Authorization: Bearer <CRON_SECRET>
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Check if auto-renewal reminders are enabled
  const { data: settings } = await supabase
    .from("email_settings")
    .select("value, enabled")
    .eq("key", "auto_renewal_reminder")
    .limit(1);

  const setting = settings?.[0];

  if (!setting?.enabled) {
    return NextResponse.json({ sent: 0, skipped: 0, reason: "disabled" });
  }

  const daysBeforeExpiry =
    (setting.value as { days_before_expiry?: number })?.days_before_expiry ?? 30;

  // Find active members whose card expires within the window
  const windowDate = new Date();
  windowDate.setDate(windowDate.getDate() + daysBeforeExpiry);
  const windowDateStr = windowDate.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: expiringCards } = await supabase
    .from("membership_cards")
    .select("member_id, valid_until")
    .eq("is_active", true)
    .gte("valid_until", todayStr)
    .lte("valid_until", windowDateStr);

  if (!expiringCards || expiringCards.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  const memberIds = expiringCards.map((c) => c.member_id);

  // Fetch those members (active status, must have originator_id)
  const { data: members } = await supabase
    .from("members")
    .select("id, first_name, last_name, email, originator_id")
    .in("id", memberIds)
    .eq("status", "active");

  if (!members || members.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  // Find members who already have an unused renewal token (skip them)
  const { data: existingTokens } = await supabase
    .from("renewal_tokens")
    .select("member_id")
    .in("member_id", memberIds)
    .eq("used", false);

  const membersWithToken = new Set(
    (existingTokens || []).map((t) => t.member_id)
  );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  let sent = 0;
  let skipped = 0;

  for (const member of members) {
    // Skip if already has unused token
    if (membersWithToken.has(member.id)) {
      skipped++;
      continue;
    }

    // Skip if no originator_id
    if (!member.originator_id) {
      console.warn(`Member ${member.id} has no originator_id — skipping`);
      skipped++;
      continue;
    }

    // Find corresponding card expiry
    const card = expiringCards.find((c) => c.member_id === member.id);
    const expiryDate = card
      ? new Date(card.valid_until).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      : "";

    // Generate renewal token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { error: insertError } = await supabase.from("renewal_tokens").insert({
      member_id: member.id,
      originator_id: member.originator_id,
      token,
      expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
      console.error(`Failed to create renewal token for ${member.id}:`, insertError);
      skipped++;
      continue;
    }

    const renewalUrl = `${appUrl}/renew/${token}`;

    await sendEmail({
      to: member.email,
      templateAlias: "membership-expiring",
      templateModel: {
        first_name: member.first_name,
        last_name: member.last_name,
        expiry_date: expiryDate,
        renewal_url: renewalUrl,
      },
    });

    sent++;
  }

  console.log(`Renewal reminders: sent=${sent}, skipped=${skipped}`);
  return NextResponse.json({ sent, skipped });
}
