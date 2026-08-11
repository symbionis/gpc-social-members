// U5 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md.
//
// The five terminal (non-checkout) outcomes of the offer landing's gate
// (lib/events/offer-landing.ts). None of these render EventFullyBookedBlock
// or WaitlistForm (R10) — an offer holder is already on the waitlist they'd be
// invited to rejoin.

export type OfferTerminalKind =
  | "invalid"
  | "closed"
  | "members_only"
  | "already_registered"
  | "seats_gone";

interface Props {
  kind: OfferTerminalKind;
  /** True when this render immediately follows a successful checkout on this link. The
   * outcome is still "already registered" — the registration now exists — but the reader
   * just created it, so the panel must congratulate rather than turn them away. */
  justRegistered?: boolean;
  /** Required for "already_registered" only. */
  eventTitle?: string;
  /** Required for "already_registered" only. Never the registration's manage_token
   *  (U5 approach step 7) — that token authorises cancellation/conversion/top-up
   *  and must not be reachable from a long-lived, potentially-forwarded offer link. */
  referenceCode?: string;
}

const COPY: Record<
  OfferTerminalKind,
  { heading: string; body: (props: Props) => React.ReactNode }
> = {
  invalid: {
    heading: "This link isn't valid",
    body: () => "Please check the link in your offer email, or contact the club for a new one.",
  },
  closed: {
    heading: "This offer is closed",
    body: () => "Registration for this event isn't open right now. Please contact the club.",
  },
  members_only: {
    heading: "This offer is for members only",
    body: () =>
      "This event is reserved for active members. Renew your membership to redeem this offer.",
  },
  already_registered: {
    heading: "You're already registered",
    body: (props) => (
      <>
        {props.justRegistered ? "You have a registration" : "You already have a registration"}
        {props.eventTitle ? (
          <>
            {" "}
            for <strong>{props.eventTitle}</strong>
          </>
        ) : null}
        {props.referenceCode ? (
          <>
            {" "}
            (reference <span className="font-mono font-semibold">{props.referenceCode}</span>)
          </>
        ) : null}
        .{" "}
        {props.justRegistered
          ? "A confirmation email is on its way — it carries the manage-booking link if you need to change anything."
          : "Look for the manage-booking link in your confirmation email to view or change it."}
      </>
    ),
  },
  seats_gone: {
    heading: "These seats have gone",
    body: () =>
      "Every seat this offer could redeem for has been taken. Your place on the list is unaffected — check back, or wait to hear from the club.",
  },
};

/**
 * Renders just the panel card, not a page shell — the caller (the offer landing
 * page) owns the shell so it can wrap every outcome, including this one, with a
 * shared registered/cancelled banner.
 */
export default function OfferTerminalPanel(props: Props) {
  const { heading, body } = COPY[props.kind];
  // Same outcome, opposite news: "already registered" is correct for a revisit and wrong for
  // the redirect that lands here seconds after a successful checkout.
  const shownHeading =
    props.kind === "already_registered" && props.justRegistered ? "You're registered" : heading;
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm">
      <h1 className="font-heading text-xl font-bold mb-2 text-marine">{shownHeading}</h1>
      <p className="font-body text-sm text-marine/70">{body(props)}</p>
    </div>
  );
}
