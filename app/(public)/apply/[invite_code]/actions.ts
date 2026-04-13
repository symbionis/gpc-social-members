"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

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
  consentIp?: string;
}): Promise<{ error: string | null; member_id: string | null }> {
  const supabase = createAdminClient();

  // Check for duplicate email
  const { data: existing } = await supabase
    .from("members")
    .select("id, status")
    .eq("email", data.email)
    .limit(1);

  if (existing && existing.length > 0) {
    const member = existing[0];
    if (member.status === "active") {
      return { error: "This email is already associated with an active membership.", member_id: null };
    } else if (member.status === "pending") {
      return { error: "An application with this email is already under review.", member_id: null };
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
      consent_ip: data.consentIp || null,
    })
    .select("id")
    .single();

  if (insertError) {
    return { error: insertError.message, member_id: null };
  }

  // Send confirmation email to applicant
  const emailResult = await sendEmail({
    to: data.email,
    templateAlias: "application-received",
    templateModel: {
      first_name: data.firstName,
      last_name: data.lastName,
      preheader: "We've received your application to the Geneva Polo Club Social Member Club.",
    },
  });

  if (!emailResult.success) {
    console.error("application-received email failed:", emailResult.error);
  }

  // Committee notification is now sent after successful card authorization
  // (in the payment_intent.amount_capturable_updated webhook handler)

  return { error: null, member_id: inserted.id };
}
