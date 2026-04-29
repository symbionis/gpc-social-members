import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const FALLBACK_ORIGINATOR_EMAIL = "frank@syks.co";
export const REACTIVATION_COOLDOWN_DAYS = 14;

export type ReactivationResult =
  | { ok: true; token: string }
  | { ok: false; status: number; error: string; code: string };

/**
 * Send a reactivation email to a single expired member. Used by both the
 * per-member admin button and the bulk endpoint, so the rules stay
 * consistent: must be expired, falls back to Frank as originator if none,
 * and respects the 14-day cooldown unless `force` is set.
 */
export async function sendReactivationEmail(
  memberId: string,
  opts: { force?: boolean } = {}
): Promise<ReactivationResult> {
  const adminClient = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { data: members } = await adminClient
    .from("members")
    .select("id, first_name, last_name, email, status, originator_id, last_reactivation_sent_at")
    .eq("id", memberId)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return { ok: false, status: 404, error: "Member not found", code: "not_found" };
  }

  if (member.status !== "expired") {
    return {
      ok: false,
      status: 400,
      error: "Member is not in expired state",
      code: "wrong_status",
    };
  }

  if (!opts.force && member.last_reactivation_sent_at) {
    const lastSent = new Date(member.last_reactivation_sent_at).getTime();
    const cutoff = Date.now() - REACTIVATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    if (lastSent > cutoff) {
      return {
        ok: false,
        status: 409,
        error: `A reactivation email was already sent within the last ${REACTIVATION_COOLDOWN_DAYS} days`,
        code: "cooldown",
      };
    }
  }

  // Resolve originator: use the member's existing one if active, otherwise
  // fall back to Frank.
  let originatorId: string | null = null;

  if (member.originator_id) {
    const { data: originators } = await adminClient
      .from("admin_users")
      .select("id, invite_link_active")
      .eq("id", member.originator_id)
      .eq("is_originator", true)
      .limit(1);
    if (originators?.[0]?.invite_link_active) {
      originatorId = originators[0].id;
    }
  }

  if (!originatorId) {
    const { data: fallback } = await adminClient
      .from("admin_users")
      .select("id, invite_link_active")
      .eq("email", FALLBACK_ORIGINATOR_EMAIL)
      .eq("is_originator", true)
      .limit(1);

    if (!fallback?.[0]?.invite_link_active) {
      return {
        ok: false,
        status: 500,
        error: "Fallback originator is not configured or inactive",
        code: "no_originator",
      };
    }
    originatorId = fallback[0].id;
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { error: insertError } = await adminClient
    .from("renewal_tokens")
    .insert({
      member_id: member.id,
      originator_id: originatorId,
      token,
      expires_at: expiresAt.toISOString(),
    });

  if (insertError) {
    console.error("[reactivation] Failed to insert renewal token:", insertError);
    return {
      ok: false,
      status: 500,
      error: "Failed to create renewal token",
      code: "token_insert_failed",
    };
  }

  const renewalUrl = `${appUrl}/renew/${token}`;

  const emailResult = await sendEmail({
    to: member.email,
    templateAlias: "membership-reactivation",
    templateModel: {
      first_name: member.first_name,
      last_name: member.last_name,
      renewal_url: renewalUrl,
    },
  });

  if (!emailResult.success) {
    return {
      ok: false,
      status: 500,
      error: "Failed to send reactivation email",
      code: "email_failed",
    };
  }

  const { error: stampErr } = await adminClient
    .from("members")
    .update({ last_reactivation_sent_at: new Date().toISOString() })
    .eq("id", member.id);

  if (stampErr) {
    console.error(
      "[reactivation] Failed to stamp last_reactivation_sent_at for",
      member.id,
      stampErr
    );
  }

  return { ok: true, token };
}
