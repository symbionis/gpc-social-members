"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function submitApplication(data: {
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  phone: string;
  companyName: string;
  companyRole: string;
  originatorNote: string;
  tierId: string;
  originatorId: string;
}) {
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
      return { error: "This email is already associated with an active membership." };
    } else if (member.status === "pending") {
      return { error: "An application with this email is already under review." };
    } else {
      return { error: "This email is already in our system. Please contact the club for assistance." };
    }
  }

  const { error: insertError } = await supabase.from("members").insert({
    email: data.email,
    first_name: data.firstName,
    last_name: data.lastName,
    title: data.title || null,
    phone: data.phone || null,
    company_name: data.companyName || null,
    company_role: data.companyRole || null,
    originator_note: data.originatorNote || null,
    tier_id: data.tierId,
    originator_id: data.originatorId,
    status: "pending",
  });

  if (insertError) {
    return { error: insertError.message };
  }

  return { error: null };
}
