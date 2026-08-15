import { NextResponse, type NextRequest } from "next/server";
import { assertAdmin, bad } from "@/lib/events/guest-list-auth";
import {
  fetchGuestLists,
  createGuestList,
  addGuestToList,
  deleteGuestList,
  resolveGuestListOnEvent,
  parseCreateListInput,
  parseAddGuestInput,
} from "@/lib/events/guest-lists";

// Admin CRUD for the NEW guest-list model (U5 of
// docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md): a guest list is a list
// attached to an event — a list name, a list contact, and guests who each hold a
// registration-less ticket (a row in `tickets`, not a separate entries table).
//
// Everything for this feature lives in this ONE route file on purpose (the plan's file
// ownership table gives U5 exactly this path). POST is disambiguated by a `type` field in
// the body rather than a nested route segment, and DELETE takes the target list id in the
// body rather than the URL — the same body-carries-the-target shape the old (comp-era)
// guest-list routes use for their own DELETE.
//
// Only handlers may be exported from this file; every helper lives in
// lib/events/guest-lists.ts and lib/events/guest-list-auth.ts
// (docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md).
//
// No seat-cap gate here (mirrors the retired comp routes' KTD6): adding a guest never
// touches capacity at all (R13) — there is nothing to gate.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  try {
    const guestLists = await fetchGuestLists(adminClient, eventId);
    return NextResponse.json({ guestLists });
  } catch (err) {
    console.error("[guest-lists] list failed", { eventId, err });
    return bad("Service temporarily unavailable", 503);
  }
}

type CreateListBody = { type: "list"; listName?: unknown; contactName?: unknown; contactEmail?: unknown; contactPhone?: unknown };
type AddGuestBody = { type: "guest"; listId?: unknown; name?: unknown; email?: unknown; ticketTypeId?: unknown };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  let body: (CreateListBody | AddGuestBody) & { type?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  if (body.type === "guest") {
    const listId = typeof body.listId === "string" ? body.listId.trim() : "";
    if (!listId) return bad("listId is required");

    // IDOR guard, BEFORE any write: the list must exist and be on THIS event. 404s
    // without distinguishing "no such list" from "that list belongs to another event".
    const guard = await resolveGuestListOnEvent(adminClient, eventId, listId);
    if ("error" in guard) return bad(guard.error, guard.status);

    const guest = parseAddGuestInput(body);
    if (!guest.ok) return bad(guest.error);

    const result = await addGuestToList(adminClient, eventId, listId, guest.value);
    if ("error" in result) return bad(result.error, result.status);

    return NextResponse.json({ success: true, ticket: result.ticket });
  }

  if (body.type === "list") {
    const input = parseCreateListInput(body);
    if (!input.ok) return bad(input.error);

    const result = await createGuestList(adminClient, eventId, input.value);
    if ("error" in result) return bad(result.error, result.status);

    return NextResponse.json({ success: true, list: result.list });
  }

  return bad('Unknown request type: `type` must be "list" or "guest"');
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  let body: { listId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const listId = typeof body.listId === "string" ? body.listId.trim() : "";
  if (!listId) return bad("listId is required");

  // Same IDOR guard as the add-guest path.
  const guard = await resolveGuestListOnEvent(adminClient, eventId, listId);
  if ("error" in guard) return bad(guard.error, guard.status);

  const result = await deleteGuestList(adminClient, eventId, listId);
  if ("error" in result) return bad(result.error, result.status);

  return NextResponse.json({ success: true });
}
