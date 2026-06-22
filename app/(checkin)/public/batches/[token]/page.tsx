import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import BookingManager, { type BookingTicket } from "@/components/public/BookingManager";
import { credentialUrl } from "@/lib/events/credential";
import { formatDate } from "@/lib/format";

// Don't leak the secret batch token to outbound links / analytics via Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

// Delegate batch page (U5 / FEAT-41). Reached via the forwarding email link. Shows
// ONLY the tickets forwarded to this delegate (scoped by batch_token), each with its
// QR; the delegate can name them or hand the QRs on. One level — no re-forward UI.
export default async function BatchPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-md px-5 py-8 sm:py-10">{body}</div>
    </div>
  );

  const notFound = shell(
    <div className="rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm">
      <h1 className="font-heading text-xl font-bold text-marine mb-2">Tickets not found</h1>
      <p className="font-body text-sm text-marine/70">
        This ticket link isn’t valid. Please ask the person who sent it for the current link.
      </p>
    </div>
  );

  // Tickets carrying this batch token (released excluded).
  const { data: ticketRows } = await supabase
    .from("tickets")
    .select(
      "id, event_id, registration_id, name, email, phone_e164, ticket_type_id, slot_status, credential_token, is_child, checked_in_at, created_at"
    )
    .eq("batch_token", token)
    .is("released_at", null);

  if (!ticketRows || ticketRows.length === 0) return notFound;

  const eventId = ticketRows[0].event_id as string;
  const { data: event } = await supabase
    .from("events")
    .select("id, title, start_date, is_published")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  if (!event || !event.is_published) return notFound;

  const { data: typeRows } = await supabase
    .from("event_ticket_types")
    .select("id, title, is_child, sort_order")
    .eq("event_id", eventId);
  const titleById = new Map<string, string>();
  const isChildById = new Map<string, boolean>();
  const sortById = new Map<string, number>();
  for (const t of typeRows ?? []) {
    titleById.set(t.id as string, (t.title as string | null) ?? "");
    isChildById.set(t.id as string, Boolean(t.is_child));
    sortById.set(t.id as string, (t.sort_order as number | null) ?? 0);
  }

  const tickets: BookingTicket[] = ticketRows
    .slice()
    .sort((a, b) => {
      const sa = a.ticket_type_id ? sortById.get(a.ticket_type_id as string) ?? 0 : 0;
      const sb = b.ticket_type_id ? sortById.get(b.ticket_type_id as string) ?? 0 : 0;
      if (sa !== sb) return sa - sb;
      return String(a.created_at).localeCompare(String(b.created_at));
    })
    .map((t) => {
      const typeId = t.ticket_type_id as string | null;
      return {
        id: t.id as string,
        name: (t.name as string | null) ?? "",
        email: (t.email as string | null) ?? "",
        phone: (t.phone_e164 as string | null) ?? "",
        typeTitle: typeId ? titleById.get(typeId) ?? "" : "",
        isChild: (t.is_child as boolean | null) ?? (typeId ? isChildById.get(typeId) ?? false : false),
        status: t.slot_status as string,
        checkedIn: t.checked_in_at !== null,
        credentialUrl: credentialUrl((t.credential_token as string | null) ?? ""),
      };
    });

  return shell(
    <BookingManager
      eventTitle={event.title as string}
      eventDate={formatDate(event.start_date as string)}
      referenceCode=""
      quantity={tickets.length}
      tickets={tickets}
      fillEndpoint={`/api/public/batches/${token}/fill`}
      variant="batch"
    />
  );
}
