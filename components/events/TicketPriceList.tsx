export interface TicketPriceRow {
  id: string;
  title: string;
  description: string | null;
  /** Price already resolved for the current viewer; null types are not listed. */
  price: number | null;
}

export function priceLabel(value: number): string {
  return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
}

/**
 * The ticket list in the event sidebar. Rendered identically whether the event is
 * open or fully booked — when the cap is reached the list stays put and only the
 * action beneath it changes (Book tickets → Join waitlist).
 */
export default function TicketPriceList({ ticketTypes }: { ticketTypes: TicketPriceRow[] }) {
  return (
    <>
      <p className="text-xs font-body text-muted-foreground uppercase tracking-wide mb-2">
        Tickets
      </p>
      <ul className="mb-4 divide-y divide-border/60">
        {ticketTypes
          .filter((t): t is TicketPriceRow & { price: number } => t.price !== null)
          .map((t) => (
            <li key={t.id} className="py-2 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-body text-sm font-medium text-marine">{t.title}</span>
                <span className="font-heading text-base font-bold text-marine shrink-0">
                  {priceLabel(t.price)}
                </span>
              </div>
              {t.description && (
                <p className="font-body text-xs text-muted-foreground mt-0.5">{t.description}</p>
              )}
            </li>
          ))}
      </ul>
    </>
  );
}
