import TicketPriceList, { type TicketPriceRow } from "@/components/events/TicketPriceList";
import WaitlistDrawer from "./WaitlistDrawer";

interface Props {
  eventId: string;
  eventTitle: string;
  /** Same list the open-for-booking state shows; it stays visible once the cap is hit. */
  ticketTypes: TicketPriceRow[];
  defaultName?: string;
  defaultEmail?: string;
}

export default function EventFullyBookedBlock({
  eventId,
  eventTitle,
  ticketTypes,
  defaultName,
  defaultEmail,
}: Props) {
  return (
    <>
      <TicketPriceList ticketTypes={ticketTypes} />
      <p className="font-body text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
        This event is fully booked. Join the waitlist and we&apos;ll let you know if a
        ticket opens up.
      </p>
      <WaitlistDrawer
        eventId={eventId}
        eventTitle={eventTitle}
        defaultName={defaultName}
        defaultEmail={defaultEmail}
      />
    </>
  );
}
