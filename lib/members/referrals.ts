// Referral records — the link between an Originator and a member they brought in.
//
// A referral row exists only once: it is written when an admin approves an
// originator-sponsored application. There is no earlier "pending referral"
// record created at invite-link click or at application submission, so the row
// coming into existence IS the conversion.
//
// That matters because the finance dashboard counts an originator's converted
// referrals by `converted_at` falling inside the selected range. A row inserted
// without that timestamp is invisible to reporting forever — which is what
// happened: every referral sat at its `status: 'pending'` default with a null
// `converted_at`, so the "converted referrals" figure read 0 for every
// originator on every range until this was fixed.
//
// The row shape lives here, apart from the route, so it can be unit-tested. The
// finance aggregator's own tests set `converted_at` on their fixtures, which is
// precisely why they stayed green while production never wrote it — a reader
// test cannot catch a writer that omits the field.

export interface ConvertedReferralRow {
  originator_id: string;
  member_id: string;
  status: "converted";
  converted_at: string;
}

// Build the referral row for a just-approved, originator-sponsored member.
// `now` is injected so the caller controls the clock and tests stay deterministic.
export function buildConvertedReferral(
  originatorId: string,
  memberId: string,
  now: Date = new Date(),
): ConvertedReferralRow {
  return {
    originator_id: originatorId,
    member_id: memberId,
    status: "converted",
    converted_at: now.toISOString(),
  };
}
