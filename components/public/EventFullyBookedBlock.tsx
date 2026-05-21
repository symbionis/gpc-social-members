import WaitlistForm from "./WaitlistForm";

interface Props {
  eventId: string;
  defaultName?: string;
  defaultEmail?: string;
}

export default function EventFullyBookedBlock({
  eventId,
  defaultName,
  defaultEmail,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-body text-muted-foreground uppercase tracking-wide mb-1">
          Registration
        </p>
        <p className="font-heading text-xl font-bold text-marine">
          Fully booked
        </p>
        <p className="font-body text-sm text-muted-foreground mt-1">
          Join the waitlist and we&apos;ll let you know if a ticket opens up.
        </p>
      </div>
      <WaitlistForm
        eventId={eventId}
        defaultName={defaultName}
        defaultEmail={defaultEmail}
      />
    </div>
  );
}
