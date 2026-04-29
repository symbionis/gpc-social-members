"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { headers } from "next/headers";

export async function submitApplication(data: {
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  phone: string;
  companyName: string;
  companyRole: string;
  originatorNote: string;
  linkedinUrl: string;
  tierId: string;
  originatorId: string;
  consentGivenAt?: string;
  honoParam?: string;
}): Promise<{ error: string | null; member_id: string | null }> {
  const supabase = createAdminClient();

  // Extract client IP server-side from request headers
  const headersList = await headers();
  const consentIp = headersList.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headersList.get("x-real-ip")
    || null;

  // Check if selected tier is free (honorary)
  const { data: tierData } = await supabase
    .from("membership_tiers")
    .select("id, price_eur")
    .eq("id", data.tierId)
    .limit(1);

  const tier = tierData?.[0];
  const isFree = tier && tier.price_eur === 0;

  // Server-side validation: free tier requires valid honorary code
  if (isFree) {
    if (!data.honoParam) {
      return { error: "Invalid application. Honorary membership requires a valid invite code.", member_id: null };
    }

    const { data: honoSettings } = await supabase
      .from("email_settings")
      .select("value")
      .eq("key", "honorary_invite_code")
      .limit(1);

    const storedCode = (honoSettings?.[0]?.value as { code?: string })?.code || "";
    if (!storedCode || data.honoParam.toLowerCase() !== storedCode.toLowerCase()) {
      return { error: "Invalid application. Honorary membership requires a valid invite code.", member_id: null };
    }
  }

  // Check for duplicate email
  const { data: existing } = await supabase
    .from("members")
    .select("id, status")
    .eq("email", data.email)
    .limit(1);

  if (existing && existing.length > 0) {
    const member = existing[0];
    if (member.status === "pending") {
      // Allow retry — return existing member_id so payment step can proceed
      return { error: null, member_id: member.id };
    } else if (member.status === "active") {
      return { error: "This email is already associated with an active membership.", member_id: null };
    } else if (member.status === "expired" || member.status === "declined") {
      // Upsert: update existing record to pending with new data
      const { error: updateError } = await supabase
        .from("members")
        .update({
          first_name: data.firstName,
          last_name: data.lastName,
          title: data.title || null,
          phone: data.phone || null,
          company_name: data.companyName || null,
          company_role: data.companyRole || null,
          originator_note: data.originatorNote || null,
          linkedin_url: data.linkedinUrl || null,
          tier_id: data.tierId,
          originator_id: data.originatorId,
          status: "pending",
          consent_given_at: data.consentGivenAt || null,
          consent_ip: consentIp,
        })
        .eq("id", member.id);

      if (updateError) {
        return { error: updateError.message, member_id: null };
      }

      // For free tier: send emails immediately
      if (isFree) {
        await sendHonoraryEmails(supabase, member.id, data);
      }

      return { error: null, member_id: member.id };
    } else {
      return { error: "This email is already in our system. Please contact the club for assistance.", member_id: null };
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("members")
    .insert({
      email: data.email,
      first_name: data.firstName,
      last_name: data.lastName,
      title: data.title || null,
      phone: data.phone || null,
      company_name: data.companyName || null,
      company_role: data.companyRole || null,
      originator_note: data.originatorNote || null,
      linkedin_url: data.linkedinUrl || null,
      tier_id: data.tierId,
      originator_id: data.originatorId,
      status: "pending",
      consent_given_at: data.consentGivenAt || null,
      consent_ip: consentIp,
    })
    .select("id")
    .single();

  if (insertError) {
    return { error: insertError.message, member_id: null };
  }

  // For free tier: send emails immediately (committee + applicant)
  if (isFree) {
    await sendHonoraryEmails(supabase, inserted.id, data);
  }

  // For paid tiers: emails are sent after card authorization (webhook handler)

  return { error: null, member_id: inserted.id };
}

async function sendHonoraryEmails(
  supabase: ReturnType<typeof createAdminClient>,
  memberId: string,
  data: { firstName: string; lastName: string; email: string; companyName: string; companyRole: string; originatorNote: string }
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Send application-received email to applicant
  await sendEmail({
    to: data.email,
    templateAlias: "application-received",
    templateModel: {
      first_name: data.firstName,
      last_name: data.lastName,
      preheader: "We've received your application to the Geneva Polo Club Social Club.",
    },
  }).catch((err) =>
    console.error("[submit] application-received email failed:", err)
  );

  // Notify committee
  const { data: committee } = await supabase
    .from("admin_users")
    .select("email, first_name")
    .or("is_approval_committee.eq.true,role.eq.super_admin");

  if (committee?.length) {
    const adminUrl = `${appUrl}/admin/applications`;
    await Promise.all(
      committee.map((admin) =>
        sendEmail({
          to: admin.email,
          templateAlias: "new-application-pending",
          templateModel: {
            recipient_first_name: admin.first_name,
            applicant_name: `${data.firstName} ${data.lastName}`,
            applicant_email: data.email,
            applicant_company: data.companyName || "—",
            applicant_role: data.companyRole || "—",
            originator_note: data.originatorNote || null,
            is_reminder: null,
            is_urgent: null,
            days_remaining: null,
            hours_remaining: null,
            admin_url: adminUrl,
            preheader: `New honorary application from ${data.firstName} ${data.lastName} is awaiting review.`,
          },
        })
      )
    ).catch((err) =>
      console.error("[submit] committee notification failed:", err)
    );
  }
}
