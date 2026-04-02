---
title: "Postmark: Email Approval Committee on New Membership Application"
date: 2026-03-31
category: integration-issues
component: email/postmark-templates
technologies: [Postmark, Next.js, Supabase, TypeScript]
symptoms:
  - Approval committee members receive no email when a new application is submitted
  - Admins must manually check dashboard to discover pending applications
related:
  - docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md
  - docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md
  - docs/email-templates/new-application-pending.html
---

# Postmark: Email Approval Committee on New Membership Application

## Problem

No notification was sent to approval committee members when a new membership application was submitted. Admins had to manually check the `/admin/applications` dashboard to discover pending applications.

## Solution

In the `submitApplication` server action, after inserting the new member and sending the applicant confirmation, query all `admin_users` where `is_approval_committee = true OR role = 'super_admin'` and send each a `new-application-pending` Postmark template email in parallel.

### Implementation (`app/(public)/apply/[invite_code]/actions.ts`)

```ts
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
          originator_note: data.originatorNote || null, // null, not "" — see Mustachio rules
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
```

### Template model variables

| Variable | Type | Description |
|----------|------|-------------|
| `recipient_first_name` | `string` | Personalises greeting for each admin |
| `applicant_name` | `string` | Full name of applicant |
| `applicant_email` | `string` | Applicant email |
| `applicant_company` | `string` | Company name or `"—"` |
| `applicant_role` | `string` | Company role or `"—"` |
| `originator_note` | `string \| null` | Pass `null` when absent so `{{#originator_note}}` block is skipped |
| `admin_url` | `string` | Link to `/admin/applications` |
| `preheader` | `string` | Email preview text |

### Postmark template

Create a `new-application-pending` template alias in Postmark. Reference HTML/TXT at:
- `docs/email-templates/new-application-pending.html`
- `docs/email-templates/new-application-pending.txt`

## Key Rules

- Use `Promise.all` — fire all admin emails in parallel, do not await sequentially
- Failures are logged but do **not** throw or block the signup response — email failure must never break the member flow
- Pass `null` (not `""`) for absent optional fields — Mustachio `{{#key}}` blocks skip on null but render on empty string
- Use `sendEmail()` from `lib/postmark.ts`, never import `ServerClient` directly (lazy init pattern)

## When to Notify Admins

Notify approval committee when a member action requires human review:
- New application submitted ✓ (this solution)
- Renewal request submitted
- Payment failure after retry exhaustion
- Any action requiring manual verification

## Files Changed

- `app/(public)/apply/[invite_code]/actions.ts` — added committee notification block
- `docs/email-templates/new-application-pending.html` — created
- `docs/email-templates/new-application-pending.txt` — created
