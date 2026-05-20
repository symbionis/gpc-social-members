import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import EventCheckInForm from "@/components/public/EventCheckInForm";
import { formatDate } from "@/lib/format";

// Public, unauthenticated door check-in page. Reached by scanning the per-event
// QR poster. Lives in the (checkin) route group so it renders without the public
// site header/footer nav — a focused, kiosk-style flow.
export default async function EventCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, title, start_date, is_published")
    .eq("id", id)
    .eq("is_published", true)
    .single();

  if (!event) notFound();

  return (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-md px-5 py-8 sm:py-10">
        <EventCheckInForm
          eventId={event.id}
          eventTitle={event.title}
          eventDate={formatDate(event.start_date)}
        />
      </div>
    </div>
  );
}
