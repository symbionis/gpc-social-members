import { describe, it, expect, beforeEach, vi } from "vitest";

// --- A tiny fake query builder ---------------------------------------------------------
//
// Mirrors the shape app/api/admin/events/[id]/guest-list/route.test.ts already uses for
// the old comp routes, generalized to per-table handlers keyed by the operation
// (select/insert/delete) and the filters chained onto it. `fromCalls` records every
// `.from(table)` invocation regardless of whether the query is ever awaited — that is
// what test scenario 3 needs: proving `event_registrations` / `event_registration_items`
// are never even reached for, not just that no row came back from them.

interface QueryCall {
  table: string;
  op: "select" | "insert" | "delete";
  filters: Record<string, unknown>;
  payload?: unknown;
}

type Handler = (call: QueryCall) => { data: unknown; error: unknown };

function makeAdminClient(handlers: Record<string, Handler>) {
  const fromCalls: string[] = [];
  const calls: QueryCall[] = [];

  function from(table: string) {
    fromCalls.push(table);
    const filters: Record<string, unknown> = {};
    let op: QueryCall["op"] = "select";
    let payload: unknown;

    function resolve() {
      const call: QueryCall = { table, op, filters, payload };
      calls.push(call);
      const handler = handlers[table];
      const result = handler ? handler(call) : { data: null, error: null };
      return Promise.resolve(result);
    }

    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: unknown) => {
        op = "insert";
        payload = p;
        return api;
      },
      delete: () => {
        op = "delete";
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      in: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      is: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: () => resolve(),
      single: () => resolve(),
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    return api;
  }

  return { from, fromCalls, calls };
}

type FakeAdminClient = ReturnType<typeof makeAdminClient>;

// =========================================================================================
// lib/events/guest-lists.ts — unit tests
// =========================================================================================

import {
  parseCreateListInput,
  parseAddGuestInput,
  addGuestToList,
  createGuestList,
  deleteGuestList,
  resolveGuestListOnEvent,
  fetchGuestLists,
} from "@/lib/events/guest-lists";

const EVENT = "evt-1";
const OTHER_EVENT = "evt-2";
const LIST = "list-1";
const TYPE_A = "tt-day1";
const TYPE_B = "tt-day2";

function ticketTypesHandler(activeIds: string[]): Handler {
  return (call) => {
    const id = call.filters.id as string;
    const eventId = call.filters.event_id as string;
    if (eventId === EVENT && activeIds.includes(id)) {
      return { data: { id }, error: null };
    }
    return { data: null, error: null };
  };
}

describe("parseCreateListInput", () => {
  it("requires a list name", () => {
    const r = parseCreateListInput({ contactName: "Astrid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });

  it("requires a contact name", () => {
    const r = parseCreateListInput({ listName: "Sponsor A" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/contact name/i);
  });

  it("accepts a list with no contact email or phone", () => {
    const r = parseCreateListInput({ listName: "Sponsor A", contactName: "Astrid Ferrari" });
    expect(r).toEqual({
      ok: true,
      value: {
        list_name: "Sponsor A",
        contact_name: "Astrid Ferrari",
        contact_email: null,
        contact_phone: null,
      },
    });
  });

  it("rejects an invalid contact email", () => {
    const r = parseCreateListInput({
      listName: "Sponsor A",
      contactName: "Astrid",
      contactEmail: "not-an-email",
    });
    expect(r.ok).toBe(false);
  });
});

describe("parseAddGuestInput", () => {
  it("requires a name", () => {
    const r = parseAddGuestInput({ ticketTypeId: TYPE_A });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });

  it("requires a ticket type", () => {
    const r = parseAddGuestInput({ name: "Bruno Keller" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ticket type/i);
  });

  it("accepts a guest with no email (R11 — name-only)", () => {
    const r = parseAddGuestInput({ name: "Bruno Keller", ticketTypeId: TYPE_A });
    expect(r).toEqual({
      ok: true,
      value: { name: "Bruno Keller", email: null, ticket_type_id: TYPE_A },
    });
  });
});

describe("addGuestToList", () => {
  it("creates a ticket with null registration_id, the chosen type, and the list id set", async () => {
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([TYPE_A]),
      tickets: (call) => {
        if (call.op === "insert") {
          return {
            data: {
              id: "tix-1",
              guest_list_id: LIST,
              registration_id: null,
              event_id: EVENT,
              ticket_type_id: TYPE_A,
              name: "Bruno Keller",
              email: null,
              slot_status: "issued",
              checked_in_at: null,
              created_at: "2026-08-15T00:00:00Z",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });

    const result = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Bruno Keller",
      email: null,
      ticket_type_id: TYPE_A,
    });

    expect("ticket" in result).toBe(true);
    if ("ticket" in result) {
      expect(result.ticket.registration_id).toBeNull();
      expect(result.ticket.guest_list_id).toBe(LIST);
      expect(result.ticket.ticket_type_id).toBe(TYPE_A);
    }

    const insertCall = client.calls.find((c) => c.table === "tickets" && c.op === "insert");
    expect(insertCall?.payload).toMatchObject({
      event_id: EVENT,
      guest_list_id: LIST,
      registration_id: null,
      ticket_type_id: TYPE_A,
      name: "Bruno Keller",
      email: null,
      slot_status: "issued",
    });
  });

  // Regression test for a code-review finding: a retried request (network retry, admin
  // double-click) had no replay guard and would silently duplicate the guest's ticket.
  it("returns the existing ticket instead of inserting a duplicate on a retried request", async () => {
    const existing = {
      id: "tix-existing",
      guest_list_id: LIST,
      registration_id: null,
      event_id: EVENT,
      ticket_type_id: TYPE_A,
      name: "Bruno Keller",
      email: null,
      slot_status: "issued",
      checked_in_at: null,
      created_at: "2026-08-15T00:00:00Z",
    };
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([TYPE_A]),
      tickets: (call) => {
        if (call.op === "select") return { data: [existing], error: null };
        if (call.op === "insert") throw new Error("should not insert a duplicate");
        return { data: null, error: null };
      },
    });

    const result = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Bruno Keller",
      email: null,
      ticket_type_id: TYPE_A,
    });

    expect("ticket" in result).toBe(true);
    if ("ticket" in result) expect(result.ticket.id).toBe("tix-existing");
    expect(client.calls.some((c) => c.table === "tickets" && c.op === "insert")).toBe(false);
  });

  it("does not treat the same person on a DIFFERENT ticket type as a duplicate (multi-day)", async () => {
    const existing = {
      id: "tix-existing",
      guest_list_id: LIST,
      registration_id: null,
      event_id: EVENT,
      ticket_type_id: TYPE_A,
      name: "Bruno Keller",
      email: null,
      slot_status: "issued",
      checked_in_at: null,
      created_at: "2026-08-15T00:00:00Z",
    };
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([TYPE_A, TYPE_B]),
      tickets: (call) => {
        if (call.op === "select") return { data: [existing], error: null };
        if (call.op === "insert")
          return { data: { id: "tix-new", ...(call.payload as Record<string, unknown>), checked_in_at: null, created_at: "x" }, error: null };
        return { data: null, error: null };
      },
    });

    const result = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Bruno Keller",
      email: null,
      ticket_type_id: TYPE_B,
    });

    expect("ticket" in result).toBe(true);
    if ("ticket" in result) expect(result.ticket.id).toBe("tix-new");
  });

  it("accepts a guest added without an email — the insert payload carries no required email", async () => {
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([TYPE_A]),
      tickets: (call) =>
        call.op === "insert"
          ? { data: { id: "tix-2", ...(call.payload as Record<string, unknown>), checked_in_at: null, created_at: "x" }, error: null }
          : { data: null, error: null },
    });

    const result = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Chiara Bosco",
      email: null,
      ticket_type_id: TYPE_A,
    });

    expect("ticket" in result).toBe(true);
    const insertCall = client.calls.find((c) => c.table === "tickets" && c.op === "insert");
    const payload = insertCall?.payload as Record<string, unknown>;
    expect(payload.email).toBeNull();
    expect("email" in payload).toBe(true); // present, just null — never omitted/required
  });

  it("never touches event_registrations or event_registration_items (KTD4)", async () => {
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([TYPE_A]),
      tickets: (call) =>
        call.op === "insert"
          ? { data: { id: "tix-3", ...(call.payload as Record<string, unknown>), checked_in_at: null, created_at: "x" }, error: null }
          : { data: null, error: null },
    });

    await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "David Nunez",
      email: null,
      ticket_type_id: TYPE_A,
    });

    expect(client.fromCalls).not.toContain("event_registrations");
    expect(client.fromCalls).not.toContain("event_registration_items");
  });

  it("refuses a ticket type that is not active on this event", async () => {
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([]), // nothing active
      tickets: () => ({ data: null, error: null }),
    });

    const result = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Ghost",
      email: null,
      ticket_type_id: "tt-unknown",
    });

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(400);
    expect(client.fromCalls).not.toContain("event_registrations");
  });

  it("a guest attending two days is two tickets (two calls, two types)", async () => {
    const client = makeAdminClient({
      event_ticket_types: ticketTypesHandler([TYPE_A, TYPE_B]),
      tickets: (call) =>
        call.op === "insert"
          ? { data: { id: `tix-${(call.payload as { ticket_type_id: string }).ticket_type_id}`, ...(call.payload as Record<string, unknown>), checked_in_at: null, created_at: "x" }, error: null }
          : { data: null, error: null },
    });

    const day1 = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Elena Rossi",
      email: null,
      ticket_type_id: TYPE_A,
    });
    const day2 = await addGuestToList(client as unknown as never, EVENT, LIST, {
      name: "Elena Rossi",
      email: null,
      ticket_type_id: TYPE_B,
    });

    expect("ticket" in day1 && "ticket" in day2).toBe(true);
    const inserts = client.calls.filter((c) => c.table === "tickets" && c.op === "insert");
    expect(inserts).toHaveLength(2);
    expect((inserts[0].payload as { ticket_type_id: string }).ticket_type_id).toBe(TYPE_A);
    expect((inserts[1].payload as { ticket_type_id: string }).ticket_type_id).toBe(TYPE_B);
  });
});

describe("resolveGuestListOnEvent", () => {
  const handler: Handler = (call) => {
    if (call.filters.id === LIST && call.filters.event_id === EVENT) {
      return {
        data: {
          id: LIST,
          event_id: EVENT,
          list_name: "Sponsor A",
          contact_name: "Astrid",
          contact_email: null,
          contact_phone: null,
          created_at: "x",
        },
        error: null,
      };
    }
    return { data: null, error: null };
  };

  it("resolves a list that belongs to the path event", async () => {
    const client = makeAdminClient({ event_guest_lists: handler });
    const result = await resolveGuestListOnEvent(client as unknown as never, EVENT, LIST);
    expect("list" in result).toBe(true);
  });

  it("404s a list id that belongs to another event", async () => {
    const client = makeAdminClient({ event_guest_lists: handler });
    const result = await resolveGuestListOnEvent(client as unknown as never, OTHER_EVENT, LIST);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(404);
  });

  it("404s an unknown list id", async () => {
    const client = makeAdminClient({ event_guest_lists: handler });
    const result = await resolveGuestListOnEvent(client as unknown as never, EVENT, "list-ghost");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(404);
  });
});

describe("createGuestList", () => {
  it("inserts one row on the path event", async () => {
    const client = makeAdminClient({
      event_guest_lists: (call) =>
        call.op === "insert"
          ? { data: { id: "list-new", ...(call.payload as Record<string, unknown>), created_at: "x" }, error: null }
          : { data: null, error: null },
    });

    const result = await createGuestList(client as unknown as never, EVENT, {
      list_name: "Sponsor A",
      contact_name: "Astrid Ferrari",
      contact_email: null,
      contact_phone: null,
    });

    expect("list" in result).toBe(true);
    const insertCall = client.calls.find((c) => c.table === "event_guest_lists" && c.op === "insert");
    expect(insertCall?.payload).toMatchObject({ event_id: EVENT, list_name: "Sponsor A" });
  });
});

describe("deleteGuestList", () => {
  it("deletes a list's never-checked-in tickets and the list itself", async () => {
    const client = makeAdminClient({
      tickets: (call) => {
        if (call.op === "select") {
          return {
            data: [
              { id: "tix-1", checked_in_at: null },
              { id: "tix-2", checked_in_at: null },
            ],
            error: null,
          };
        }
        // delete: both rows match checked_in_at IS NULL, so both come back deleted.
        return { data: [{ id: "tix-1" }, { id: "tix-2" }], error: null };
      },
      event_guest_lists: () => ({ data: null, error: null }), // delete
    });

    const result = await deleteGuestList(client as unknown as never, EVENT, LIST);
    expect(result).toEqual({ ok: true });

    const ticketDelete = client.calls.find((c) => c.table === "tickets" && c.op === "delete");
    expect(ticketDelete).toBeTruthy();
    // The delete itself is filtered on checked_in_at IS NULL too, not just the precheck.
    expect(ticketDelete?.filters).toMatchObject({ checked_in_at: null });
    const listDelete = client.calls.find((c) => c.table === "event_guest_lists" && c.op === "delete");
    expect(listDelete).toBeTruthy();
  });

  it("refuses to delete a list with any checked-in ticket, and deletes nothing", async () => {
    const client = makeAdminClient({
      tickets: (call) => {
        if (call.op === "select") {
          return {
            data: [
              { id: "tix-1", checked_in_at: null },
              { id: "tix-2", checked_in_at: "2026-08-15T20:00:00Z" },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
      event_guest_lists: () => ({ data: null, error: null }),
    });

    const result = await deleteGuestList(client as unknown as never, EVENT, LIST);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(409);

    expect(client.calls.some((c) => c.op === "delete")).toBe(false);
  });

  // Regression test for a race a code review caught: a guest checks in between the precheck
  // SELECT and the DELETE. The precheck reads checked_in_at: null for both tickets, but by
  // the time the DELETE runs (filtered on checked_in_at IS NULL), tix-2 has since checked in
  // and no longer matches — so only tix-1 comes back deleted, fewer than the precheck's 2.
  it("refuses and deletes nothing further when a check-in races the delete", async () => {
    const client = makeAdminClient({
      tickets: (call) => {
        if (call.op === "select") {
          return {
            data: [
              { id: "tix-1", checked_in_at: null },
              { id: "tix-2", checked_in_at: null },
            ],
            error: null,
          };
        }
        // delete: tix-2 checked in between the precheck and this call, so the
        // checked_in_at IS NULL filter now excludes it — only tix-1 matches.
        return { data: [{ id: "tix-1" }], error: null };
      },
      event_guest_lists: () => ({ data: null, error: null }),
    });

    const result = await deleteGuestList(client as unknown as never, EVENT, LIST);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(409);

    // The list itself must not be deleted when the ticket delete raced a check-in.
    const listDelete = client.calls.find((c) => c.table === "event_guest_lists" && c.op === "delete");
    expect(listDelete).toBeUndefined();
  });
});

describe("fetchGuestLists", () => {
  it("groups tickets under their list", async () => {
    const client = makeAdminClient({
      event_guest_lists: () => ({
        data: [
          {
            id: LIST,
            event_id: EVENT,
            list_name: "Sponsor A",
            contact_name: "Astrid",
            contact_email: null,
            contact_phone: null,
            created_at: "x",
          },
        ],
        error: null,
      }),
      tickets: () => ({
        data: [
          {
            id: "tix-1",
            guest_list_id: LIST,
            registration_id: null,
            event_id: EVENT,
            ticket_type_id: TYPE_A,
            name: "Bruno Keller",
            email: null,
            slot_status: "issued",
            checked_in_at: null,
            created_at: "x",
          },
        ],
        error: null,
      }),
    });

    const entries = await fetchGuestLists(client as unknown as never, EVENT);
    expect(entries).toHaveLength(1);
    expect(entries[0].guests).toHaveLength(1);
    expect(entries[0].guests[0]).toMatchObject({ name: "Bruno Keller", checkedIn: false });
  });

  it("returns an empty array with no lists, and never queries tickets", async () => {
    const client = makeAdminClient({ event_guest_lists: () => ({ data: [], error: null }) });
    const entries = await fetchGuestLists(client as unknown as never, EVENT);
    expect(entries).toEqual([]);
    expect(client.fromCalls).not.toContain("tickets");
  });
});

// =========================================================================================
// Route handlers — auth + IDOR guard
//
// The plan's file-ownership table gives this unit exactly one test file
// (lib/events/guest-lists.test.ts), so the route's own auth and 404 behaviour is proven
// here by importing its handlers directly, rather than in a sibling route.test.ts. Same
// mocking shape as app/api/admin/events/[id]/guest-list/route.test.ts (the old comp
// route): mock the two Supabase entry points guest-list-auth.ts's assertAdmin() calls,
// not assertAdmin itself.
// =========================================================================================

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET, POST, DELETE } from "@/app/api/admin/events/[id]/guest-lists/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function routeAdminClient(opts: {
  admins?: { id: string; role: string }[];
  extra?: Record<string, Handler>;
}): FakeAdminClient {
  return makeAdminClient({
    admin_users: () => ({ data: opts.admins ?? [], error: null }),
    ...opts.extra,
  });
}

const superAdmin = [{ id: "admin-1", role: "super_admin" }];

function req(method: string, body: unknown) {
  return new Request(`http://localhost/api/admin/events/${EVENT}/guest-lists`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function callGet(eventId = EVENT) {
  const getReq = new Request(`http://localhost/api/admin/events/${eventId}/guest-lists`, {
    method: "GET",
  });
  return GET(getReq as never, { params: Promise.resolve({ id: eventId }) });
}
function callPost(body: unknown, eventId = EVENT) {
  return POST(req("POST", body) as never, { params: Promise.resolve({ id: eventId }) });
}
function callDelete(body: unknown, eventId = EVENT) {
  return DELETE(req("DELETE", body) as never, { params: Promise.resolve({ id: eventId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.co" }));
  mockedCreateAdminClient.mockReturnValue(
    routeAdminClient({ admins: superAdmin }) as unknown as ReturnType<typeof createAdminClient>
  );
});

describe("guest-lists route — auth", () => {
  it("401s an unauthenticated GET", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await callGet()).status).toBe(401);
  });

  it("401s an unauthenticated POST", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await callPost({ type: "list", listName: "A", contactName: "B" })).status).toBe(401);
  });

  it("401s an unauthenticated DELETE", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await callDelete({ listId: LIST })).status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({ admins: [] }) as unknown as ReturnType<typeof createAdminClient>
    );
    expect((await callPost({ type: "list", listName: "A", contactName: "B" })).status).toBe(403);
  });

  it("403s an admin whose role is not allowed", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({ admins: [{ id: "admin-2", role: "read_only" }] }) as unknown as ReturnType<
        typeof createAdminClient
      >
    );
    expect((await callPost({ type: "list", listName: "A", contactName: "B" })).status).toBe(403);
  });
});

describe("guest-lists route — write", () => {
  it("creates a list", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({
        admins: superAdmin,
        extra: {
          event_guest_lists: (call) =>
            call.op === "insert"
              ? { data: { id: "list-new", ...(call.payload as Record<string, unknown>), created_at: "x" }, error: null }
              : { data: null, error: null },
        },
      }) as unknown as ReturnType<typeof createAdminClient>
    );

    const res = await callPost({ type: "list", listName: "Sponsor A", contactName: "Astrid Ferrari" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.list.list_name).toBe("Sponsor A");
  });

  it("404s adding a guest to a list id from another event", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({
        admins: superAdmin,
        extra: {
          // The list exists, but only on OTHER_EVENT — the path event is EVENT.
          event_guest_lists: (call) =>
            call.filters.id === LIST && call.filters.event_id === OTHER_EVENT
              ? { data: { id: LIST, event_id: OTHER_EVENT }, error: null }
              : { data: null, error: null },
        },
      }) as unknown as ReturnType<typeof createAdminClient>
    );

    const res = await callPost(
      { type: "guest", listId: LIST, name: "Ghost", ticketTypeId: TYPE_A },
      EVENT
    );
    expect(res.status).toBe(404);
  });

  it("adds a guest to a list on the path event", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({
        admins: superAdmin,
        extra: {
          event_guest_lists: (call) =>
            call.filters.id === LIST && call.filters.event_id === EVENT
              ? { data: { id: LIST, event_id: EVENT }, error: null }
              : { data: null, error: null },
          event_ticket_types: ticketTypesHandler([TYPE_A]),
          tickets: (call) =>
            call.op === "insert"
              ? { data: { id: "tix-1", ...(call.payload as Record<string, unknown>), checked_in_at: null, created_at: "x" }, error: null }
              : { data: null, error: null },
        },
      }) as unknown as ReturnType<typeof createAdminClient>
    );

    const res = await callPost({ type: "guest", listId: LIST, name: "Bruno Keller", ticketTypeId: TYPE_A });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket.registration_id).toBeNull();
    expect(body.ticket.guest_list_id).toBe(LIST);
  });

  it("404s deleting a list id from another event", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({
        admins: superAdmin,
        extra: {
          event_guest_lists: () => ({ data: null, error: null }),
        },
      }) as unknown as ReturnType<typeof createAdminClient>
    );

    const res = await callDelete({ listId: LIST });
    expect(res.status).toBe(404);
  });

  it("409s deleting a list with a checked-in guest", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({
        admins: superAdmin,
        extra: {
          event_guest_lists: (call) =>
            call.filters.id === LIST && call.filters.event_id === EVENT
              ? { data: { id: LIST, event_id: EVENT }, error: null }
              : { data: null, error: null },
          tickets: (call) =>
            call.op === "select"
              ? { data: [{ id: "tix-1", checked_in_at: "2026-08-15T20:00:00Z" }], error: null }
              : { data: null, error: null },
        },
      }) as unknown as ReturnType<typeof createAdminClient>
    );

    const res = await callDelete({ listId: LIST });
    expect(res.status).toBe(409);
  });

  it("400s a POST with an unrecognised type", async () => {
    const res = await callPost({ type: "sponsor", listId: LIST });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/list.*guest/i);
  });

  it("400s a guest POST with no listId", async () => {
    const res = await callPost({ type: "guest", name: "Ghost", ticketTypeId: TYPE_A });
    expect(res.status).toBe(400);
  });
});

describe("guest-lists route — read", () => {
  it("200s an admin GET with the event's guest lists", async () => {
    mockedCreateAdminClient.mockReturnValue(
      routeAdminClient({
        admins: superAdmin,
        extra: {
          event_guest_lists: () => ({ data: [], error: null }),
        },
      }) as unknown as ReturnType<typeof createAdminClient>
    );

    const res = await callGet();
    expect(res.status).toBe(200);
    expect((await res.json()).guestLists).toEqual([]);
  });
});
