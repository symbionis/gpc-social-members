import type { MemberStatus } from "@/types/database";

/**
 * A member with status `approved` has been accepted by the committee but
 * has not yet completed payment. They transition to `active` only when the
 * Stripe webhook records a successful payment. Use this to surface an
 * "Awaiting Payment" indicator in admin views.
 */
export function isAwaitingPayment(status: MemberStatus | string): boolean {
  return status === "approved";
}
