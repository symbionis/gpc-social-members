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
}): Promise<{ error: string | null; member_id: string | null }> {
  const supabase = createAdminClient();

  // Extract client IP server-side from request headers
  const headersList = await headers();
  const consentIp = headersList.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headersList.get("x-real-ip")
    || null;

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

  // Application-received email is sent after successful card authorization
  // (in the payment_intent.amount_capturable_updated webhook handler)
  // Committee notification is also sent there

  return { error: null, member_id: inserted.id };
}
