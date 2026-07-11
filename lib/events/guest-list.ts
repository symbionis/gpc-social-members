// Payload types, the paste parser, validation and error mapping for the admin comp
// guest list (U2 of docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md).
//
// Everything here lives OUTSIDE route.ts on purpose: a Next.js App Router route file
// may export only its HTTP handlers, and a stray helper export passes `tsc --noEmit`
// while failing the production build. See
// docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md
//
// The database is the real validator — create_comp_guest_list / add_comp_guests resolve
// every ticket_type_id against the event and RAISE. These helpers only shape the payload
// the RPCs expect (snake_case, contract of supabase/migrations/20260711120000_comp_guest_list.sql)
// and turn the RAISE into a useful HTTP answer.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// --- RPC payload shapes (p_lead / p_guests) --------------------------------------

export interface CompLeadPayload {
  name: string;
  email: string;
  ticket_type_id: string;
  /** Optional; the lead may have no phone. */
  phone_e164: string | null;
}

export interface CompGuestPayload {
  name: string;
  ticket_type_id: string;
  /** A comp guest is NAME-ONLY by design (R3): both may be absent. */
  email: string | null;
  phone_e164: string | null;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The exhaustive status remove_comp_guest returns in its jsonb payload — it refuses by
 * status rather than by RAISE (see supabase/migrations/20260711120000_comp_guest_list.sql).
 * Typed rather than read as a bare string so a typo in any literal on the reading side is
 * a compile error, not a silent fall-through to the generic 404.
 */
export type RemoveCompGuestStatus = "not_found" | "is_lead" | "checked_in" | "ok";

// --- Validation ------------------------------------------------------------------

// Loose shape check only; the DB CHECK is the real guard. This exists so an obvious
// typo surfaces as a 400 rather than a 23514 dressed up as a 500.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_NAME_LENGTH = 120;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optionalEmail(v: unknown): string | null {
  const s = str(v).toLowerCase();
  return s === "" ? null : s;
}

function optionalPhone(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

/** Validate + normalize the create route's `lead` object into the RPC's p_lead. */
export function parseLeadInput(input: unknown): Validated<CompLeadPayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "A lead is required" };
  }
  const raw = input as Record<string, unknown>;

  const name = str(raw.name);
  if (!name) return { ok: false, error: "The lead requires a name" };

  const email = str(raw.email).toLowerCase();
  if (!email) return { ok: false, error: "The lead requires an email" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: `The lead's email is invalid: ${email}` };

  const ticketTypeId = str(raw.ticketTypeId);
  if (!ticketTypeId) return { ok: false, error: "The lead requires a ticket type" };

  return {
    ok: true,
    value: { name, email, ticket_type_id: ticketTypeId, phone_e164: optionalPhone(raw.phone) },
  };
}

/**
 * Validate + normalize a `guests` array into the RPC's p_guests. A missing array is an
 * empty list (a comp list may be the lead alone); a non-array is a client error. Each
 * guest needs a name and a ticket type — nothing else (R3).
 */
export function parseGuestsInput(input: unknown): Validated<CompGuestPayload[]> {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "guests must be an array" };

  const value: CompGuestPayload[] = [];
  for (const [i, entry] of input.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `Guest ${i + 1} is not a guest object` };
    }
    const raw = entry as Record<string, unknown>;

    const name = str(raw.name);
    if (!name) return { ok: false, error: `Guest ${i + 1} requires a name` };
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `Guest ${i + 1}'s name is too long` };
    }

    const ticketTypeId = str(raw.ticketTypeId);
    if (!ticketTypeId) return { ok: false, error: `Guest ${i + 1} (${name}) requires a ticket type` };

    value.push({
      name,
      ticket_type_id: ticketTypeId,
      email: optionalEmail(raw.email),
      phone_e164: optionalPhone(raw.phone),
    });
  }
  return { ok: true, value };
}

/** Every distinct ticket type id the client asked for, lead included. */
export function suppliedTicketTypeIds(
  lead: CompLeadPayload | null,
  guests: CompGuestPayload[]
): string[] {
  const ids = new Set<string>();
  if (lead) ids.add(lead.ticket_type_id);
  for (const g of guests) ids.add(g.ticket_type_id);
  return [...ids];
}

// --- Error mapping ---------------------------------------------------------------

export const DUPLICATE_LEAD_MESSAGE = "This email is already registered for this event";

/** Postgres RAISE EXCEPTION without an ERRCODE. All three comp RPCs raise with this. */
const PG_RAISE = "P0001";
/** The partial unique index on (event_id, lower(email)) for paid/free registrations. */
const PG_UNIQUE_VIOLATION = "23505";

const RAISE_PREFIX = /^(create_comp_guest_list|add_comp_guests|remove_comp_guest):\s*/;

export interface CompRpcError {
  code?: string | null;
  message?: string | null;
}

/**
 * Classify an error from a comp guest-list RPC.
 * - 23505 → 409: the lead already has a paid/free registration for this event.
 * - P0001 → 400: one of the RPC's own refusals (bad ticket type, no active types,
 *   not a guest list, ...). Its message is written for a human, so it is surfaced.
 * - anything else → 500 with the caller's fallback (nothing usable to show).
 */
export function mapCompRpcError(
  err: CompRpcError,
  fallback: string
): { status: number; message: string } {
  const code = err.code ?? "";
  const raw = (err.message ?? "").trim();

  if (code === PG_UNIQUE_VIOLATION) return { status: 409, message: DUPLICATE_LEAD_MESSAGE };
  if (code === PG_RAISE || RAISE_PREFIX.test(raw)) {
    return { status: 400, message: raw.replace(RAISE_PREFIX, "") || fallback };
  }
  return { status: 500, message: fallback };
}

/**
 * True when an RPC refusal was about a ticket type that would not RESOLVE — i.e. the
 * "every ticket_type_id must be an active ticket type of event X" raise, which is worth
 * enriching with the offending id. Deliberately keyed on the `ticket_type_id` token, so
 * it does NOT catch "event X has no active ticket types" (a different refusal, where
 * every supplied id is "unresolved" and naming them would only mislead).
 */
export function mentionsTicketType(message: string): boolean {
  return /ticket_type_id/i.test(message);
}

/**
 * Which of the supplied ticket type ids are NOT an active type of this event. Used only
 * on the error path, to turn the RPC's generic "every ticket_type_id must be an active
 * ticket type of event X" into a message naming the offending type. Best-effort: if the
 * lookup fails, the caller falls back to the RPC's own message.
 */
export async function unresolvedTicketTypeIds(
  supabase: SupabaseClient<Database>,
  eventId: string,
  suppliedIds: string[]
): Promise<string[]> {
  if (suppliedIds.length === 0) return [];

  const { data, error } = await supabase
    .from("event_ticket_types")
    .select("id")
    .eq("event_id", eventId)
    .is("archived_at", null);

  if (error) return [];

  const active = new Set((data ?? []).map((t) => t.id));
  return suppliedIds.filter((id) => !active.has(id));
}

// --- Paste parser ----------------------------------------------------------------

export interface ParsedGuestNameRow {
  /** 1-based line number in the original pasted text (for the inline error report). */
  line: number;
  name: string;
}

export interface GuestNameRowError {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseGuestNamesResult {
  rows: ParsedGuestNameRow[];
  errors: GuestNameRowError[];
}

/**
 * Parse a pasted sponsor list: ONE NAME PER LINE. A sponsor's list is names, not a CSV —
 * but pastes do arrive with trailing columns, so the first comma-separated column wins
 * and the rest is discarded. Blank lines are ignored. The admin picks the ticket type
 * per row in the UI afterwards, so nothing here resolves one.
 *
 * Mirrors the parser of the retired Import tab it replaces: pure, no DB, returns rows
 * plus a per-line error list rather than throwing.
 */
export function parseGuestNames(text: string): ParseGuestNamesResult {
  const rows: ParsedGuestNameRow[] = [];
  const errors: GuestNameRowError[] = [];

  const lines = (text ?? "").split(/\r\n|\r|\n/);

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (raw.trim() === "") return; // blank / all-whitespace lines are not rows

    const name = (raw.split(",")[0] ?? "").trim().replace(/\s+/g, " ");

    if (!name) {
      errors.push({ line, raw, reason: "Missing name" });
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      errors.push({ line, raw, reason: `Name is too long (max ${MAX_NAME_LENGTH} characters)` });
      return;
    }

    rows.push({ line, name });
  });

  return { rows, errors };
}
