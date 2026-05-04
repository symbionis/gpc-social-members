import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAudience } from "@/lib/broadcast/audience";
import type { AudienceFilter } from "@/lib/broadcast/types";
import type { MemberStatus } from "@/types/database";
import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_STATUSES: Array<MemberStatus | "all"> = [
  "all",
  "active",
  "expired",
];

/**
 * Server-side preview render for the compose page.
 *
 * Returns:
 *   - { html }: the rendered preview HTML (body wrapped in a minimal layout
 *     approximation with the "Member Only Communication" banner). This is
 *     intentionally NOT the full Postmark layout — admins should rely on
 *     Postmark for the final render. The preview exists to verify that the
 *     body content (formatting, links, lists) looks right.
 *   - { recipient_count }: how many members would receive this broadcast
 *     given the supplied audience filter, after consent filtering. Drives
 *     the confirm dialog on the composer.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  if (admins?.[0]?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const subject: string = typeof body.subject === "string" ? body.subject : "";
  const bodyHtml: string = typeof body.body_html === "string" ? body.body_html : "";
  const filterRaw = body.audience_filter ?? {};
  const status = filterRaw.status as MemberStatus | "all";
  const tierIds: string[] = Array.isArray(filterRaw.tier_ids)
    ? filterRaw.tier_ids.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0
      )
    : typeof filterRaw.tier_id === "string" && filterRaw.tier_id.length > 0
      ? [filterRaw.tier_id]
      : [];

  let recipientCount = 0;
  let skippedCount = 0;
  if (ALLOWED_STATUSES.includes(status)) {
    const filter: AudienceFilter = { status, tier_ids: tierIds };
    try {
      const { recipients, skipped } = await resolveAudience(filter);
      recipientCount = recipients.length;
      skippedCount = skipped;
    } catch (err) {
      console.error("[broadcasts/preview] audience resolution failed", err);
      return NextResponse.json(
        { error: "Failed to resolve audience" },
        { status: 500 }
      );
    }
  }

  // Sample model — preview substitutes the first sample member if available,
  // otherwise the calling admin so the admin sees the substitution behaviour.
  const { data: sample } = await adminClient
    .from("members")
    .select("first_name, last_name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const firstName = sample?.first_name ?? "Friend";
  const lastName = sample?.last_name ?? "";

  const html = renderPreviewHtml({
    subject,
    bodyHtml,
    firstName,
    lastName,
  });

  return NextResponse.json({
    html,
    recipient_count: recipientCount,
    skipped_count: skippedCount,
  });
}

/**
 * Minimal preview wrapper. Mirrors the visual cues of the members-comms
 * layout (banner + branded heading) without trying to be pixel-perfect.
 * Postmark renders the real layout when the broadcast actually sends.
 */
function renderPreviewHtml({
  subject,
  bodyHtml,
  firstName,
  lastName,
}: {
  subject: string;
  bodyHtml: string;
  firstName: string;
  lastName: string;
}): string {
  // Allow {{first_name}} / {{last_name}} substitution in the preview so admins
  // can validate the merge tags they typed.
  const renderedBody = bodyHtml
    .replace(/\{\{first_name\}\}/g, escapeHtml(firstName))
    .replace(/\{\{last_name\}\}/g, escapeHtml(lastName));

  const subjectLabel = subject || "(no subject)";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { margin: 0; padding: 0; background: #F2F4F6; font-family: 'Poppins', 'Helvetica Neue', Arial, sans-serif; color: #052938; }
  .wrap { max-width: 600px; margin: 0 auto; background: #FFFFFF; }
  .subject-meta { padding: 12px 16px; background: #FFFFFF; border-bottom: 1px solid #E5E9EE; font-size: 12px; color: #8B99A8; }
  .subject-meta strong { color: #052938; font-weight: 500; }
  .header { background: #052938; color: #FFFFFF; text-align: center; padding: 24px 16px; }
  .header h2 { margin: 0; font-family: 'Playfair Display', Georgia, serif; font-weight: 700; font-size: 22px; letter-spacing: 0.5px; }
  .header small { display: block; margin-top: 6px; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; color: #95CEE1; }
  .accent { height: 3px; background: linear-gradient(90deg, #052938 0%, #95CEE1 50%, #052938 100%); }
  .banner { background: #052938; color: #FFFFFF; text-align: center; padding: 10px 16px; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }
  .body { padding: 32px 24px; line-height: 1.65; font-size: 16px; }
  .body h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 26px; margin: 0 0 16px; }
  .body a { color: #052938; }
  .footer { padding: 16px; text-align: center; color: #8B99A8; font-size: 12px; }
</style>
</head><body>
<div class="wrap">
  <div class="subject-meta">Subject: <strong>${escapeHtml(subjectLabel)}</strong></div>
  <div class="header">
    <h2>Geneva Polo<br />Social Club</h2>
    <small>Elegance &middot; Passion &middot; Fun</small>
  </div>
  <div class="accent"></div>
  <div class="banner">Member Only Communication</div>
  <div class="body">
    ${renderedBody}
    <p style="margin-top: 32px;">Warm regards,<br><strong>The Geneva Polo Social Club Team</strong></p>
  </div>
  <div class="footer">Preview only. Final email rendered by Postmark.</div>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
