import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for creating/tearing down test events directly (bypasses
// RLS), mirroring how e2e/global-setup.ts authenticates. Reads the same env the
// Playwright config loads from .env.local.
export function adminDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const EVENTS_ADMIN_ROLES = ["super_admin", "team_admin", "events_admin"];

/** Whether an email has a role allowed to manage the invite link. */
export async function isEventsAdmin(
  db: SupabaseClient,
  email: string
): Promise<boolean> {
  const { data } = await db
    .from("admin_users")
    .select("role")
    .eq("email", email)
    .limit(1);
  const role = data?.[0]?.role as string | undefined;
  return !!role && EVENTS_ADMIN_ROLES.includes(role);
}

interface TicketTypeSeed {
  title: string;
  price_member?: number | null;
  price_non_member?: number | null;
  invite_price?: number | null;
  counts_as_seat?: boolean;
}

interface CreateOpts {
  inviteCode?: string | null;
  invitePrice?: number | null;
  registrationEnabled?: boolean;
  visibility?: "members_only" | "public";
  title?: string;
  /** Override the seeded ticket types. Defaults to a single "Standard". */
  ticketTypes?: TicketTypeSeed[];
}

/**
 * Create a published test event and return its id. Defaults to a members-only,
 * registration-enabled event with a guest price — override per test. Always
 * far-future dated and clearly named so a leaked fixture is obvious. Pair every
 * call with deleteEvent in an afterAll/finally.
 */
export async function createTestEvent(
  db: SupabaseClient,
  opts: CreateOpts = {}
): Promise<string> {
  const { data: types } = await db
    .from("event_types")
    .select("id")
    .limit(1);
  const eventTypeId = types?.[0]?.id;
  if (!eventTypeId) {
    throw new Error(
      "invite-link e2e: no event_types row exists to attach a test event to"
    );
  }

  const isPublic = (opts.visibility ?? "members_only") === "public";

  // Prices live on event_ticket_types now — the event row carries none.
  const { data, error } = await db
    .from("events")
    .insert({
      title: opts.title ?? "E2E invite-link test (safe to delete)",
      event_type_id: eventTypeId,
      start_date: "2099-01-01",
      visibility: opts.visibility ?? "members_only",
      is_published: true,
      registration_enabled: opts.registrationEnabled ?? true,
      invite_code: opts.inviteCode ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`invite-link e2e: failed to create test event: ${error?.message}`);
  }
  const eventId = data.id as string;

  // Seed ticket types carrying the prices the page/register API read. Defaults
  // to a single "Standard"; pass opts.ticketTypes for a multi-type event.
  const seeds: TicketTypeSeed[] = opts.ticketTypes ?? [
    {
      title: "Standard",
      price_member: 20,
      price_non_member: isPublic ? 30 : null,
      invite_price: isPublic ? null : opts.invitePrice === undefined ? 50 : opts.invitePrice,
    },
  ];
  const { error: ttError } = await db.from("event_ticket_types").insert(
    seeds.map((s, i) => ({
      event_id: eventId,
      title: s.title,
      price_member: s.price_member ?? null,
      price_non_member: s.price_non_member ?? null,
      invite_price: s.invite_price ?? null,
      counts_as_seat: s.counts_as_seat ?? true,
      sort_order: i,
    }))
  );
  if (ttError) {
    throw new Error(`invite-link e2e: failed to seed ticket type: ${ttError.message}`);
  }
  return eventId;
}

export async function deleteEvent(db: SupabaseClient, id: string | undefined) {
  if (!id) return;
  await db.from("events").delete().eq("id", id);
}
