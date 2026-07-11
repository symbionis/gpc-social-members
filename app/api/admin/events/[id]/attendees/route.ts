import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Unauthorized", status: 401 as const };

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  if (!admins?.[0] || !["super_admin", "team_admin", "events_admin", "finance"].includes(admins[0].role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Formula-injection guard: name / contact come from unauthenticated public
  // surfaces (self-registration, door). A leading =, +, -, @ (or tab/CR) makes
  // spreadsheet apps execute the cell as a formula, so neutralize it with a
  // leading quote.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Heuristic split of a single "Full name" string for non-members: the last
// whitespace-separated token is the last name, everything before it the first
// name(s). One token → all first name. Members use their authoritative split.
function splitFullName(name: string | null): { first: string; last: string } {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// One printed line. Every ticket sold gets exactly one of these, whether it was
// pre-registered (a claimed ticket), merely minted (an issued ticket — nobody named
// yet), or reconstructed from the purchase record (a legacy party with no ticket rows
// at all). A blank cell means "not known", never "no".
interface SheetRow {
  bookingRef: string;
  last: string;
  first: string;
  ticketType: string;
  email: string;
  phone: string;
  isMember: string;
  partyLead: string;
  tickets: string;
  waiver: string;
  arrived: string;
}

const HEADERS = [
  "booking_ref",
  "last_name",
  "first_name",
  "ticket_type",
  "email",
  "phone",
  "is_member",
  "party_lead",
  "tickets",
  "waiver",
  "arrived",
];

function emit(r: SheetRow): string {
  return [
    r.bookingRef,
    r.last,
    r.first,
    r.ticketType,
    r.email,
    r.phone,
    r.isMember,
    r.partyLead,
    r.tickets,
    r.waiver,
    r.arrived,
  ]
    .map(csvEscape)
    .join(",");
}

// Surname sort, case- and accent-aware (Ärnström, Öberg file where a Swiss reader
// expects them). A row with no surname to sort on goes last, rather than silently
// landing at the top of the sheet under an empty string.
function bySurname(
  a: { last: string; first: string; bookingRef: string },
  b: { last: string; first: string; bookingRef: string }
): number {
  if (!a.last !== !b.last) return a.last ? -1 : 1;
  const last = a.last.localeCompare(b.last, undefined, { sensitivity: "base" });
  if (last !== 0) return last;
  const first = a.first.localeCompare(b.first, undefined, { sensitivity: "base" });
  if (first !== 0) return first;
  return a.bookingRef.localeCompare(b.bookingRef);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;

  const { id: eventId } = await params;
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "csv") {
    return NextResponse.json({ error: "format=csv required" }, { status: 400 });
  }

  // A failed load must never be exported as an empty/zeroed sheet — that would put a
  // confident-but-wrong roster in front of door staff. Fail loud.
  const failLoad = (scope: string, error: unknown) => {
    console.error("[admin/events/attendees-csv] query failed", {
      eventId,
      scope,
      err: error,
    });
    return NextResponse.json(
      { error: "Could not load attendees for export" },
      { status: 500 }
    );
  };

  const { data: event } = await adminClient
    .from("events")
    .select("id, title, start_date")
    .eq("id", eventId)
    .single();

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Every ticket sold, claimed or not. An `issued` row is a ticket nobody has named
  // yet — it carries its ticket type and its party, just no person — so it is exactly
  // the blank check-off line door staff need, and must NOT be filtered out.
  //
  // The filter is an allowlist, not a negation of 'claimed': tickets_slot_status_check
  // still permits the legacy 'unclaimed' value, and on a sheet that governs door
  // admission an unrecognized status must fall OFF the roster, never onto it as an
  // anonymous tickable line. `credential_token` is deliberately not selected — it is a
  // bearer QR token, and a printed sheet of them would admit anyone who photographs it.
  interface TicketRow {
    id: string;
    registration_id: string | null;
    member_id: string | null;
    name: string | null;
    email: string | null;
    phone_e164: string | null;
    is_lead: boolean;
    slot_status: string;
    ticket_type_id: string | null;
    waiver_accepted_at: string | null;
    checked_in_at: string | null;
    created_at: string;
  }
  const { data: ticketData, error: ticketsError } = await adminClient
    .from("tickets")
    .select(
      "id, registration_id, member_id, name, email, phone_e164, is_lead, slot_status, ticket_type_id, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", eventId)
    .in("slot_status", ["issued", "claimed"])
    .is("released_at", null)
    .order("created_at", { ascending: true });
  if (ticketsError) return failLoad("tickets", ticketsError);

  const tickets = (ticketData || []) as TicketRow[];

  const { data: typeRows, error: typeRowsError } = await adminClient
    .from("event_ticket_types")
    .select("id, title")
    .eq("event_id", eventId);
  if (typeRowsError) return failLoad("event_ticket_types", typeRowsError);
  const ticketTitleById = new Map<string, string>();
  for (const t of typeRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
  }

  // The purchase record. `quantity` is how many tickets the party owns — the number of
  // lines it must occupy on the sheet. `name`/`email`/`phone_e164`/`member_id` are the
  // purchaser, which is how a legacy party with no ticket rows still gets a real lead.
  interface RegRow {
    id: string;
    quantity: number | null;
    reference_code: string | null;
    name: string | null;
    email: string | null;
    phone_e164: string | null;
    member_id: string | null;
  }
  const { data: regData, error: regRowsError } = await adminClient
    .from("event_registrations")
    .select("id, quantity, reference_code, name, email, phone_e164, member_id")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  if (regRowsError) return failLoad("event_registrations", regRowsError);
  const regs = (regData || []) as RegRow[];
  const registrationIds = regs.map((r) => r.id);

  // Per-ticket-type purchased quantities. These label the padded lines: a party that
  // bought 3 × Standard + 1 × Vegetarian and has only its Standard lead claimed pads
  // 2 × Standard and 1 × Vegetarian. That is arithmetic on the purchase record, not a
  // guess — and without it the per-type pivot that replaced the old TOTALS block would
  // undercount by exactly the padded tickets.
  interface ItemRow {
    registration_id: string;
    ticket_type_id: string | null;
    title_snapshot: string | null;
    quantity: number | null;
  }
  const { data: itemData, error: itemRowsError } = registrationIds.length
    ? await adminClient
        .from("event_registration_items")
        .select("registration_id, ticket_type_id, title_snapshot, quantity")
        .in("registration_id", registrationIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (itemRowsError) return failLoad("event_registration_items", itemRowsError);

  const itemsByReg = new Map<string, ItemRow[]>();
  for (const item of (itemData ?? []) as ItemRow[]) {
    const list = itemsByReg.get(item.registration_id) ?? [];
    list.push(item);
    itemsByReg.set(item.registration_id, list);
  }

  // Authoritative first/last for members. Tickets and registrations both store only a
  // single `name` string; the members table is the real split.
  const memberIds = [
    ...new Set(
      [...tickets.map((t) => t.member_id), ...regs.map((r) => r.member_id)].filter(
        (m): m is string => !!m
      )
    ),
  ];
  const memberNameById = new Map<string, { first: string; last: string }>();
  if (memberIds.length) {
    const { data: memberRows, error: memberRowsError } = await adminClient
      .from("members")
      .select("id, first_name, last_name")
      .in("id", memberIds);
    if (memberRowsError) return failLoad("members", memberRowsError);
    for (const m of memberRows ?? []) {
      memberNameById.set(m.id as string, {
        first: (m.first_name as string | null) ?? "",
        last: (m.last_name as string | null) ?? "",
      });
    }
  }

  const nameOf = (memberId: string | null, name: string | null) =>
    (memberId && memberNameById.get(memberId)) || splitFullName(name);
  const typeTitle = (id: string | null) => (id ? ticketTitleById.get(id) ?? "" : "");
  const isClaimed = (t: TicketRow) => t.slot_status === "claimed";

  const liveByReg = new Map<string, TicketRow[]>();
  for (const t of tickets) {
    if (!t.registration_id) continue;
    const list = liveByReg.get(t.registration_id) ?? [];
    list.push(t);
    liveByReg.set(t.registration_id, list);
  }

  // A claimed ticket prints the person as recorded. An unclaimed one prints its ticket
  // type and its party, and leaves every person-cell blank — we do not assert "no" or
  // "unsigned" about someone who has not been named.
  const rowFromTicket = (
    t: TicketRow,
    bookingRef: string,
    partyLead: string
  ): SheetRow => {
    const base = {
      bookingRef,
      ticketType: typeTitle(t.ticket_type_id),
      partyLead,
      tickets: "",
    };
    if (!isClaimed(t)) {
      return {
        ...base,
        last: "",
        first: "",
        email: "",
        phone: "",
        isMember: "",
        waiver: "",
        arrived: "",
      };
    }
    const { first, last } = nameOf(t.member_id, t.name);
    return {
      ...base,
      last,
      first,
      email: t.email ?? "",
      phone: t.phone_e164 ?? "",
      isMember: t.member_id ? "yes" : "no",
      waiver: t.waiver_accepted_at ? "signed" : "unsigned",
      arrived: t.checked_in_at ? "yes" : "no",
    };
  };

  const today = new Date().toISOString().slice(0, 10);

  interface Party {
    sortKey: { last: string; first: string; bookingRef: string };
    rows: SheetRow[];
  }
  const parties: Party[] = [];

  for (const reg of regs) {
    const bookingRef = reg.reference_code ?? "";
    const quantity = reg.quantity ?? 0;
    const live = liveByReg.get(reg.id) ?? [];
    const leadTicket = live.find((t) => t.is_lead && isClaimed(t)) ?? null;

    // Who the guests are a `guest of`: the claimed lead when there is one, else the
    // purchaser on the registration. So this is never a dangling "guest of ", even on
    // a party with no ticket rows at all.
    const leadDisplayName = (leadTicket?.name ?? reg.name ?? "").trim();
    const guestOf = leadDisplayName ? `guest of ${leadDisplayName}` : "";

    // The type slots this party owns that no live ticket row accounts for, expanded in
    // purchase order. Drained by the reconstructed lead and the padded guests below.
    const unaccounted = new Map<string, number>();
    for (const t of live) {
      if (!t.ticket_type_id) continue;
      unaccounted.set(t.ticket_type_id, (unaccounted.get(t.ticket_type_id) ?? 0) + 1);
    }
    const typePool: string[] = [];
    for (const item of itemsByReg.get(reg.id) ?? []) {
      const id = item.ticket_type_id;
      const purchased = item.quantity ?? 0;
      const covered = id ? Math.min(unaccounted.get(id) ?? 0, purchased) : 0;
      if (id) unaccounted.set(id, (unaccounted.get(id) ?? 0) - covered);
      const title = id ? typeTitle(id) : (item.title_snapshot ?? "").trim();
      for (let i = 0; i < purchased - covered; i++) typePool.push(title);
    }
    const nextType = () => typePool.shift() ?? "";

    let leadRow: SheetRow;
    if (leadTicket) {
      leadRow = {
        ...rowFromTicket(leadTicket, bookingRef, "lead"),
        tickets: String(quantity),
      };
    } else {
      // No claimed lead ticket. Rebuild the lead from the purchaser: a legacy party,
      // minted before ticket rows existed, still knows who bought it — so the party is
      // never anonymous or unsortable. waiver/arrived stay blank: there is no ticket
      // row to read them from, and the sheet should not claim she is unsigned.
      const { first, last } = nameOf(reg.member_id, reg.name);
      leadRow = {
        bookingRef,
        last,
        first,
        ticketType: nextType(),
        email: reg.email ?? "",
        phone: reg.phone_e164 ?? "",
        isMember: reg.member_id ? "yes" : "no",
        partyLead: "lead",
        tickets: String(quantity),
        waiver: "",
        arrived: "",
      };
    }

    const guestTickets = live.filter((t) => t !== leadTicket);
    const namedGuests = guestTickets
      .filter(isClaimed)
      .map((t) => rowFromTicket(t, bookingRef, guestOf))
      .sort(bySurname);
    const unnamedGuests = guestTickets
      .filter((t) => !isClaimed(t))
      .map((t) => rowFromTicket(t, bookingRef, guestOf));

    // Pad up to the tickets actually sold. `live.length` already counts the claimed
    // lead when there is one; a reconstructed lead occupies one of the party's lines
    // too. A party whose live rows exceed its quantity pads by zero and is never
    // truncated — losing a real ticket is worse than an over-long party block.
    const emitted = live.length + (leadTicket ? 0 : 1);
    const padCount = Math.max(0, quantity - emitted);
    const padded: SheetRow[] = Array.from({ length: padCount }, () => ({
      bookingRef,
      last: "",
      first: "",
      ticketType: nextType(),
      email: "",
      phone: "",
      isMember: "",
      partyLead: guestOf,
      tickets: "",
      waiver: "",
      arrived: "",
    }));

    // On a current-generation event, minting should have produced these rows. Padding
    // on a future event means real ticket rows are missing: the sheet stays correct,
    // but the data underneath it does not, so say so rather than paper over it.
    if (padCount > 0 && event.start_date && event.start_date >= today) {
      console.warn("[admin/events/attendees-csv] padded a party on a future event", {
        eventId,
        registrationId: reg.id,
        quantity,
        liveRows: live.length,
        padded: padCount,
      });
    }

    parties.push({
      sortKey: { last: leadRow.last, first: leadRow.first, bookingRef },
      rows: [leadRow, ...namedGuests, ...unnamedGuests, ...padded],
    });
  }

  // Ops/bulk-imported tickets belong to no registration. Each is its own one-person
  // party, filed under its own surname among the leads.
  for (const t of tickets) {
    if (t.registration_id) continue;
    const row = rowFromTicket(t, "", "");
    parties.push({
      sortKey: { last: row.last, first: row.first, bookingRef: "" },
      rows: [row],
    });
  }

  parties.sort((a, b) => bySurname(a.sortKey, b.sortKey));

  const csv = [HEADERS.join(","), ...parties.flatMap((p) => p.rows.map(emit))].join("\n");

  const slug =
    event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") ||
    event.id;
  const datePart = today.replace(/-/g, "");
  const filename = `attendees-${slug}-${datePart}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
