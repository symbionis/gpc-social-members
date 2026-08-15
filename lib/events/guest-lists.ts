// The guest-list model (U5 of docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md):
// a guest list is a list attached to an event — a list name, a list contact, and guests who
// each hold a registration-less ticket. There is no entries table — a guest on a list IS a
// ticket (KD10). Schema: supabase/migrations/20260814160001_guest_lists.sql.
//
// This module is imported by server-only callers: app/api/admin/events/[id]/guest-lists/route.ts
// (the CRUD route), app/(admin)/admin/events/[id]/attendees/page.tsx (reads `fetchGuestLists`
// for the overview and the guest-list tab), and its own tests. components/admin/GuestList.tsx
// (a "use client" component)
// declares its own local prop types instead of importing `GuestListEntry`/`GuestListGuest`
// from here — not for bundle-safety (this module's only import, `createAdminClient`, is
// type-only and pulls in nothing at runtime), but because the shapes genuinely differ: the
// client's version resolves `ticketTypeTitle` (a lookup this module has no ticket-type data
// to do) and renames `guests` to `people`. See that component's header for the exact mapping.
//
// ROW TYPES ARE LOCAL rather than imported from `types/database.ts` (which does know about
// `event_guest_lists`/`tickets.guest_list_id`): `lib/supabase/admin.ts`'s createAdminClient()
// deliberately carries no Database generic ("avoids strict type issues with service role
// operations"), so the interfaces below are for OUR code's benefit, not the client's — they
// are not enforced by the compiler against Supabase's response shape regardless of what the
// generated types contain.

import type { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_RE, MAX_PERSON_NAME, ticketIdentityKey } from "@/lib/events/order";

export type AdminClient = ReturnType<typeof createAdminClient>;

// --- Row shapes (local — see header) ----------------------------------------------

export interface EventGuestListRow {
  id: string;
  event_id: string;
  list_name: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface GuestListTicketRow {
  id: string;
  guest_list_id: string | null;
  registration_id: string | null;
  event_id: string;
  ticket_type_id: string | null;
  name: string | null;
  email: string | null;
  slot_status: string;
  checked_in_at: string | null;
  created_at: string;
}

// --- Shapes the route hands back to the admin UI -----------------------------------

export interface GuestListGuest {
  ticketId: string;
  name: string;
  email: string | null;
  ticketTypeId: string | null;
  checkedIn: boolean;
}

export interface GuestListEntry {
  id: string;
  eventId: string;
  listName: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  guests: GuestListGuest[];
}

// --- Validation ---------------------------------------------------------------------

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

// EMAIL_RE/MAX_PERSON_NAME (imported above) are a loose shape check only; a real ticket
// type lookup and the DB's own constraints are the actual guards. This exists so an obvious
// typo surfaces as a 400, not a 500.

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optionalStr(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

function optionalEmail(v: unknown): string | null {
  const s = str(v).toLowerCase();
  return s === "" ? null : s;
}

export interface CreateListPayload {
  list_name: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
}

/** Validate + normalize the request body for creating a new list (R9). */
export function parseCreateListInput(input: unknown): Validated<CreateListPayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "A list is required" };
  }
  const raw = input as Record<string, unknown>;

  const listName = str(raw.listName);
  if (!listName) return { ok: false, error: "The list requires a name" };
  if (listName.length > MAX_PERSON_NAME) {
    return { ok: false, error: "The list name is too long" };
  }

  const contactName = str(raw.contactName);
  if (!contactName) return { ok: false, error: "The list requires a contact name" };
  if (contactName.length > MAX_PERSON_NAME) {
    return { ok: false, error: "The contact name is too long" };
  }

  const contactEmail = optionalEmail(raw.contactEmail);
  if (contactEmail && !EMAIL_RE.test(contactEmail)) {
    return { ok: false, error: `The contact email is invalid: ${contactEmail}` };
  }

  return {
    ok: true,
    value: {
      list_name: listName,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: optionalStr(raw.contactPhone),
    },
  };
}

export interface AddGuestPayload {
  name: string;
  email: string | null;
  ticket_type_id: string;
}

/**
 * Validate + normalize the request body for adding one guest (R10, R11). A guest is
 * name-only by design — an email is optional — and carries exactly one ticket type.
 */
export function parseAddGuestInput(input: unknown): Validated<AddGuestPayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "A guest is required" };
  }
  const raw = input as Record<string, unknown>;

  const name = str(raw.name);
  if (!name) return { ok: false, error: "The guest requires a name" };
  if (name.length > MAX_PERSON_NAME) return { ok: false, error: "The guest's name is too long" };

  const email = optionalEmail(raw.email);
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: `The guest's email is invalid: ${email}` };
  }

  const ticketTypeId = str(raw.ticketTypeId);
  if (!ticketTypeId) return { ok: false, error: "The guest requires a ticket type" };

  return { ok: true, value: { name, email, ticket_type_id: ticketTypeId } };
}

// --- Ticket-type resolution ----------------------------------------------------------

/** True only if ticketTypeId is an ACTIVE ticket type of THIS event. */
export async function resolvesTicketType(
  adminClient: AdminClient,
  eventId: string,
  ticketTypeId: string
): Promise<boolean> {
  const { data, error } = await adminClient
    .from("event_ticket_types")
    .select("id")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return Boolean(data);
}

// --- List resolution (IDOR guard) -----------------------------------------------------

/**
 * The guard every write against an EXISTING list must pass before touching it: the list
 * exists AND belongs to the path event — a list id from another event is a 404 that does
 * not distinguish "no such list" from "that list is on another event". Supersedes the
 * comp-era `assertGuestListOnEvent` (retired from lib/events/guest-list-auth.ts, U9).
 */
export async function resolveGuestListOnEvent(
  adminClient: AdminClient,
  eventId: string,
  listId: string
): Promise<{ list: EventGuestListRow } | { error: string; status: number }> {
  const { data, error } = await adminClient
    .from("event_guest_lists")
    .select("id, event_id, list_name, contact_name, contact_email, contact_phone, created_at")
    .eq("id", listId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) {
    console.error("[guest-lists] list lookup failed", { eventId, listId, err: error });
    return { error: "Service temporarily unavailable", status: 503 };
  }
  if (!data) return { error: "Guest list not found", status: 404 };
  return { list: data as EventGuestListRow };
}

// --- Reads -----------------------------------------------------------------------------

/** Every guest list for an event, each with its guests (tickets). */
export async function fetchGuestLists(
  adminClient: AdminClient,
  eventId: string
): Promise<GuestListEntry[]> {
  const { data: lists, error: listsError } = await adminClient
    .from("event_guest_lists")
    .select("id, event_id, list_name, contact_name, contact_email, contact_phone, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (listsError) throw listsError;

  const listRows = (lists ?? []) as EventGuestListRow[];
  if (listRows.length === 0) return [];

  const listIds = listRows.map((l) => l.id);
  const { data: tickets, error: ticketsError } = await adminClient
    .from("tickets")
    .select(
      "id, guest_list_id, registration_id, event_id, ticket_type_id, name, email, slot_status, checked_in_at, created_at"
    )
    .in("guest_list_id", listIds)
    .is("released_at", null)
    .order("created_at", { ascending: true });
  if (ticketsError) throw ticketsError;

  const ticketsByList = new Map<string, GuestListTicketRow[]>();
  for (const t of (tickets ?? []) as GuestListTicketRow[]) {
    if (!t.guest_list_id) continue;
    const arr = ticketsByList.get(t.guest_list_id) ?? [];
    arr.push(t);
    ticketsByList.set(t.guest_list_id, arr);
  }

  return listRows.map((l) => ({
    id: l.id,
    eventId: l.event_id,
    listName: l.list_name,
    contactName: l.contact_name,
    contactEmail: l.contact_email,
    contactPhone: l.contact_phone,
    guests: (ticketsByList.get(l.id) ?? []).map((t) => ({
      ticketId: t.id,
      name: t.name ?? "",
      email: t.email,
      ticketTypeId: t.ticket_type_id,
      checkedIn: t.checked_in_at !== null,
    })),
  }));
}

// --- Writes ----------------------------------------------------------------------------

export async function createGuestList(
  adminClient: AdminClient,
  eventId: string,
  input: CreateListPayload
): Promise<{ list: EventGuestListRow } | { error: string; status: number }> {
  const { data, error } = await adminClient
    .from("event_guest_lists")
    .insert({
      event_id: eventId,
      list_name: input.list_name,
      contact_name: input.contact_name,
      contact_email: input.contact_email,
      contact_phone: input.contact_phone,
    })
    .select("id, event_id, list_name, contact_name, contact_email, contact_phone, created_at")
    .single();

  if (error) {
    console.error("[guest-lists] create failed", { eventId, err: error });
    return { error: "Could not create the guest list", status: 500 };
  }
  return { list: data as EventGuestListRow };
}

/**
 * Add ONE guest to an existing list: one ticket insert, nothing else (R12, KTD4). No
 * `event_registrations` row and no `event_registration_items` row are ever written from
 * this path — that absence is what keeps a guest-list guest off the seat count
 * (lib/events/seat-usage.ts sums only those two tables' rows and never reads `tickets`
 * at all). `slot_status: 'issued'` is what makes a name-only, email-less row legal
 * against `tickets_contact_present` before the door ever runs (KTD10) — do not change it
 * to 'claimed'.
 */
export async function addGuestToList(
  adminClient: AdminClient,
  eventId: string,
  listId: string,
  guest: AddGuestPayload
): Promise<{ ticket: GuestListTicketRow } | { error: string; status: number }> {
  const resolved = await resolvesTicketType(adminClient, eventId, guest.ticket_type_id);
  if (!resolved) {
    return {
      error: `Unknown or archived ticket type for this event: ${guest.ticket_type_id}`,
      status: 400,
    };
  }

  // Replay guard: the retired comp-era route required an idempotency key specifically to
  // survive a network retry or an admin double-click. This route has none, and there is no
  // DB uniqueness constraint on (guest_list_id, name, email, ticket_type_id) — a retried
  // request would otherwise silently duplicate the guest's ticket. Mirror the R4 identity key
  // (case-folded name, lowercased email, ticket type) and short-circuit to the existing row
  // rather than inserting a second one.
  const wantedKey = ticketIdentityKey(guest.name, guest.email ?? "", guest.ticket_type_id);
  const { data: existingRows, error: existingError } = await adminClient
    .from("tickets")
    .select(
      "id, guest_list_id, registration_id, event_id, ticket_type_id, name, email, slot_status, checked_in_at, created_at"
    )
    .eq("guest_list_id", listId)
    .is("released_at", null);
  if (existingError) {
    console.error("[guest-lists] add guest replay check failed", { eventId, listId, err: existingError });
    return { error: "Could not add the guest", status: 500 };
  }
  const duplicate = (existingRows as GuestListTicketRow[] | null ?? []).find(
    (t) =>
      t.ticket_type_id &&
      ticketIdentityKey(t.name ?? "", t.email ?? "", t.ticket_type_id) === wantedKey
  );
  if (duplicate) {
    return { ticket: duplicate };
  }

  const { data, error } = await adminClient
    .from("tickets")
    .insert({
      event_id: eventId,
      guest_list_id: listId,
      registration_id: null,
      ticket_type_id: guest.ticket_type_id,
      name: guest.name,
      email: guest.email,
      slot_status: "issued",
      is_lead: false,
    })
    .select(
      "id, guest_list_id, registration_id, event_id, ticket_type_id, name, email, slot_status, checked_in_at, created_at"
    )
    .single();

  if (error) {
    console.error("[guest-lists] add guest failed", { eventId, listId, err: error });
    return { error: "Could not add the guest", status: 500 };
  }
  return { ticket: data as GuestListTicketRow };
}

/**
 * Delete a list. All-or-nothing (the simpler of the two options the plan allows): if ANY
 * of the list's tickets have checked in, the whole delete is refused — destroying a
 * checked-in guest's ticket would erase attendance history that follow-up and the
 * check-in figures read. Otherwise every (never-checked-in) ticket on the list is deleted,
 * then the list itself.
 *
 * The precheck SELECT and the DELETE are two separate round trips, so a door check-in can
 * land in between: the precheck reads `checked_in_at: null`, then the guest scans in, then
 * this function's DELETE would otherwise remove that just-checked-in ticket anyway — erasing
 * exactly the attendance record the precheck exists to protect. The DELETE below is filtered
 * on `checked_in_at IS NULL` too (not just the precheck), so a ticket that flips mid-request
 * survives the delete; if fewer rows come back deleted than the precheck counted, that is the
 * race actually happening, and the whole operation is refused rather than left half-done.
 */
export async function deleteGuestList(
  adminClient: AdminClient,
  eventId: string,
  listId: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const { data: ticketRows, error: readError } = await adminClient
    .from("tickets")
    .select("id, checked_in_at")
    .eq("guest_list_id", listId)
    .is("released_at", null);

  if (readError) {
    console.error("[guest-lists] delete precheck failed", { eventId, listId, err: readError });
    return { error: "Service temporarily unavailable", status: 503 };
  }

  const rows = (ticketRows ?? []) as { id: string; checked_in_at: string | null }[];
  if (rows.some((t) => t.checked_in_at !== null)) {
    return {
      error:
        "This list has a checked-in guest and cannot be deleted — deleting it would erase their attendance history.",
      status: 409,
    };
  }

  if (rows.length > 0) {
    const { data: deletedRows, error: deleteTicketsError } = await adminClient
      .from("tickets")
      .delete()
      .eq("guest_list_id", listId)
      .is("released_at", null)
      .is("checked_in_at", null)
      .select("id");
    if (deleteTicketsError) {
      console.error("[guest-lists] delete tickets failed", { eventId, listId, err: deleteTicketsError });
      return { error: "Could not delete the guest list", status: 500 };
    }
    if ((deletedRows ?? []).length < rows.length) {
      // A guest checked in between the precheck and this delete: fewer rows matched the
      // checked_in_at IS NULL filter than the precheck counted, so at least one ticket
      // survived (correctly) and the list is now in a mixed state. Refuse rather than
      // silently deleting the rest — the admin can retry, and the checked-in guest's own
      // 409 branch above will fire on that retry.
      console.error("[guest-lists] delete raced a check-in — refusing", {
        eventId,
        listId,
        expected: rows.length,
        deleted: (deletedRows ?? []).length,
      });
      return {
        error:
          "A guest on this list just checked in. The list was not deleted — please try again.",
        status: 409,
      };
    }
  }

  const { error: deleteListError } = await adminClient
    .from("event_guest_lists")
    .delete()
    .eq("id", listId)
    .eq("event_id", eventId);
  if (deleteListError) {
    console.error("[guest-lists] delete list failed", { eventId, listId, err: deleteListError });
    return { error: "Could not delete the guest list", status: 500 };
  }
  return { ok: true };
}
