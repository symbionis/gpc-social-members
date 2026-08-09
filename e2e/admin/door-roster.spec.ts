import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminDb,
  createTestEvent,
  deleteEvent,
  isEventsAdmin,
} from "../helpers/invite-fixtures";

// Drives the printable door roster at /print/door-roster/[id]. Runs with the admin
// storageState from global-setup. Like the flyer/invite-link suites, it self-skips
// when the seeded test account lacks an events-admin role (true on a fresh/unseeded
// DB) so it stays committed and green where the test admin isn't provisioned.
//
// The point of this suite is the *flat A→Z* behaviour that unit/component tests prove
// in isolation: it seeds two real parties so that one party's guest sorts above both
// its own lead and the other party's lead, and asserts the rendered sheet lists all
// three surnames in one global order — plus a trailing "To fill in" divider for the
// one unnamed ticket. If the sheet ever regressed to party-grouping, the surname order
// would flip.

const ADMIN_EMAIL = "test@syks.co";
const db = adminDb();

const TITLE = "E2E Door Roster (safe to delete)";

// Party "Smith" (lead) with guest "Adams"; party "Brown" (lead) with one unnamed
// issued ticket. Flat A→Z surname order across both parties is [Adams, Brown, Smith],
// then the unnamed line under the divider.
async function seedParty(
  client: SupabaseClient,
  eventId: string,
  ticketTypeId: string,
  opts: { ref: string; leadName: string; guest?: { name: string }; unnamed?: boolean }
) {
  const { data: reg, error: regErr } = await client
    .from("event_registrations")
    .insert({
      event_id: eventId,
      name: opts.leadName,
      email: "e2e-door@x.co",
      quantity: 2,
      is_member: false,
      unit_amount_chf: 0,
      total_amount_chf: 0,
      reference_code: opts.ref,
      status: "paid",
    })
    .select("id")
    .single();
  if (regErr || !reg) throw new Error(`seedParty: registration failed: ${regErr?.message}`);
  const registrationId = reg.id as string;

  const tickets: Record<string, unknown>[] = [
    {
      event_id: eventId,
      registration_id: registrationId,
      ticket_type_id: ticketTypeId,
      name: opts.leadName,
      is_lead: true,
      slot_status: "claimed",
    },
  ];
  if (opts.guest) {
    tickets.push({
      event_id: eventId,
      registration_id: registrationId,
      ticket_type_id: ticketTypeId,
      name: opts.guest.name,
      is_lead: false,
      slot_status: "claimed",
    });
  }
  if (opts.unnamed) {
    // An issued, never-claimed ticket: a blank fill-in line on the sheet.
    tickets.push({
      event_id: eventId,
      registration_id: registrationId,
      ticket_type_id: ticketTypeId,
      name: null,
      is_lead: false,
      slot_status: "issued",
    });
  }
  const { error: tErr } = await client.from("tickets").insert(tickets);
  if (tErr) throw new Error(`seedParty: tickets failed: ${tErr.message}`);
}

test.describe("Door roster (/print/door-roster/[id])", () => {
  let canRun = false;
  let eventId: string | undefined;

  test.beforeAll(async () => {
    canRun = await isEventsAdmin(db, ADMIN_EMAIL);
    if (!canRun) return;

    eventId = await createTestEvent(db, { title: TITLE });
    const { data: types } = await db
      .from("event_ticket_types")
      .select("id")
      .eq("event_id", eventId)
      .limit(1);
    const ticketTypeId = types?.[0]?.id as string | undefined;
    if (!ticketTypeId) throw new Error("door-roster e2e: seeded event has no ticket type");

    // Smith's party carries guest Adams; Brown's party carries one unnamed ticket.
    await seedParty(db, eventId, ticketTypeId, {
      ref: "EV-DR-SMITH",
      leadName: "Zoe Smith",
      guest: { name: "Ann Adams" },
    });
    await seedParty(db, eventId, ticketTypeId, {
      ref: "EV-DR-BROWN",
      leadName: "Bo Brown",
      unnamed: true,
    });
  });

  test.afterAll(async () => {
    await deleteEvent(db, eventId); // cascades registrations + tickets
  });

  test.beforeEach(() => {
    test.skip(
      !canRun,
      `${ADMIN_EMAIL} is not an events_admin+; seed an admin role to run these.`
    );
  });

  test("lists every ticket in one flat A→Z surname order, unnamed lines last", async ({
    page,
  }) => {
    await page.goto(`/print/door-roster/${eventId}`);

    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();

    // The headline behaviour: guest "Adams" sorts to the TOP by her own surname —
    // above her own lead "Smith" AND above the other party's lead "Brown". A grouped
    // sheet would print [Brown | Smith, Adams] or [Smith, Adams | Brown] instead.
    const surnames = await page.locator(".roster-table .surname").allTextContents();
    expect(surnames).toEqual(["Adams", "Brown", "Smith"]);

    // The single unnamed (issued) ticket prints as a blank fill-in line, fenced off
    // under the "To fill in" divider.
    await expect(page.getByText("To fill in")).toBeVisible();
    await expect(page.locator(".roster-table .name-blank")).toHaveCount(1);

    // Per-row self-sufficiency: the guest row carries its lead's booking ref + label
    // even though it sorts away from the lead.
    await expect(page.getByText("guest of Zoe Smith")).toBeVisible();
    await expect(page.getByText("EV-DR-SMITH").first()).toBeVisible();
  });

  test("unauthenticated request is redirected to admin login", async ({ browser }) => {
    // Fresh context without the admin storageState.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const anon = await ctx.newPage();
    await anon.goto(`/print/door-roster/${eventId ?? "00000000-0000-0000-0000-000000000000"}`);
    await expect(anon).toHaveURL(/\/admin\/login/);
    await ctx.close();
  });
});
