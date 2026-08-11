import type { Metadata } from "next";
import type { ReactNode } from "react";
import { resolvePurchaseHistory } from "@/lib/events/purchase-history";
import { formatDate, formatDateTime } from "@/lib/format";

// Same "Free" vs "CHF x.xx" convention as lib/events/receipt-lines.ts's own priceLabel —
// duplicated rather than imported since that one is deliberately unexported (formatting only,
// scoped to that module's own line-shaping).
function priceLabel(chf: number): string {
  return chf === 0 ? "Free" : `CHF ${chf.toFixed(2)}`;
}

// Don't leak the secret manage_token to outbound links / analytics via Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

// The payer's receipt page (U6, R22-R25). Reached from the payer's own ticket manage page —
// no login, the manage_token IS the credential. Lists every booking the payer has made
// across ALL events, newest first, each with its own payments (original checkout + every
// applied buy-more) rendered from the booking's own recorded item lines (R24) — never the
// payment provider's hosted receipt.
//
// KTD4 (the load-bearing access-control property): resolvePurchaseHistory refuses unless the
// token's OWN ticket carries tickets.is_lead. It does NOT compare the registration's email to
// anything — a holder can rewrite their own ticket's name/email (R1), so gating on the address
// would let a non-payer read another person's spend just by editing their own ticket to match
// the payer's address. `is_lead` is set once at checkout and cannot be forged that way.
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const shell = (body: ReactNode) => (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-md px-5 py-8 sm:py-10">{body}</div>
    </div>
  );

  const notice = (heading: string, message: string) => (
    <div className="rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm">
      <h1 className="font-heading text-xl font-bold mb-2 text-marine">{heading}</h1>
      <p className="font-body text-sm text-marine/70">{message}</p>
    </div>
  );

  const history = await resolvePurchaseHistory(token);

  if (!history) {
    return shell(
      notice(
        "Receipt not found",
        "This link isn’t valid. It may have been renewed — please check the most recent link in your email."
      )
    );
  }

  if (history.bookings.length === 0) {
    return shell(notice("No purchases yet", "We couldn’t find any purchases on this account."));
  }

  return shell(
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="font-heading text-3xl font-bold text-marine">Your receipts</h1>
        <p className="mt-1 font-body text-base text-marine/80">
          Every purchase you’ve made, across every event.
        </p>
      </header>

      <div className="space-y-6">
        {history.bookings.map((booking) => (
          <section
            key={booking.registrationId}
            className="rounded-2xl border border-border/60 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="font-heading text-lg font-bold text-marine">{booking.eventTitle}</h2>
              <span className="font-body text-sm text-marine/70">
                {formatDate(booking.eventStartDate)}
              </span>
            </div>
            {booking.referenceCode && (
              <p className="mb-3 font-body text-sm text-marine/70">
                Booking <span className="font-semibold text-marine">{booking.referenceCode}</span>
              </p>
            )}

            <div className="space-y-4">
              {booking.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="rounded-xl border border-border/60 bg-cream/40 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="font-body text-sm text-marine/70">
                      {payment.paidAtIso ? formatDateTime(payment.paidAtIso) : "Not yet paid"}
                    </span>
                    {payment.refunded ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-body text-xs font-semibold text-amber-900">
                        Refunded {priceLabel(payment.refundedChf)}
                      </span>
                    ) : payment.chargeReference ? (
                      <span className="font-body text-xs text-marine/60">
                        Ref {payment.chargeReference}
                      </span>
                    ) : null}
                  </div>

                  <ul className="space-y-1">
                    {payment.lines.map((line, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between font-body text-sm text-marine/90"
                      >
                        <span>
                          {line.quantity} × {line.title}
                        </span>
                        <span>{line.lineLabel}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2 font-body text-sm font-semibold text-marine">
                    <span>Total</span>
                    <span>{priceLabel(payment.totalChf)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
