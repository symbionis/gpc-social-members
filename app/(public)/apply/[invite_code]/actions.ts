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

  // Notify all approval committee members and super admins
  const { data: committee } = await supabase
    .from("admin_users")
    .select("email, first_name")
    .or("is_approval_committee.eq.true,role.eq.super_admin");

  if (committee && committee.length > 0) {
    const adminUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/applications`;
    const applicantCompany = [data.companyName, data.companyRole].filter(Boolean).join(" — ");

    const notifyResults = await Promise.all(
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
            admin_url: adminUrl,
            preheader: `New application from ${data.firstName} ${data.lastName}${applicantCompany ? ` (${applicantCompany})` : ""} is awaiting review.`,
          },
        })
      )
    );

    const failed = notifyResults.filter((r) => !r.success);
    if (failed.length > 0) {
      console.error(`new-application-pending email failed for ${failed.length} recipient(s)`);
    }
  }

  return { error: null };
}
