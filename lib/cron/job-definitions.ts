export interface JobUIDefinition {
  name: string;
  description: string;
  schedule: string;
  scheduleLabel: string;
  emailSettingsKey?: string;
}

export const JOB_DEFINITIONS: Record<string, JobUIDefinition> = {
  "renewal-reminders": {
    name: "Renewal Reminders",
    description:
      "Sends multi-stage email reminders to active members approaching membership expiry",
    schedule: "0 0 * * *",
    scheduleLabel: "Daily at 00:00 UTC",
    emailSettingsKey: "auto_renewal_reminder",
  },
  "expire-memberships": {
    name: "Expire Memberships",
    description:
      "Deactivates memberships past their end date, deactivates cards, and sends expiry notifications",
    schedule: "5 0 * * *",
    scheduleLabel: "Daily at 00:05 UTC",
    emailSettingsKey: "auto_expiry_notification",
  },
  "payment-reminders": {
    name: "Payment Reminders",
    description:
      "Sends payment reminders to approved members who haven't completed payment (legacy flow)",
    schedule: "0 8 * * *",
    scheduleLabel: "Daily at 08:00 UTC",
    emailSettingsKey: "payment_reminder",
  },
  "committee-reminders": {
    name: "Committee Reminders",
    description:
      "Sends escalating reminders to the approval committee about pending applications with active card holds",
    schedule: "0 * * * *",
    scheduleLabel: "Hourly",
  },
  "hold-expiry-safety": {
    name: "Hold Expiry Safety Net",
    description:
      "Catches missed payment_intent.canceled webhooks and marks stale authorized payments as hold_expired",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC",
  },
};
