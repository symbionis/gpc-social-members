import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseImportRows } from "@/lib/events/roster-import";
import { importAttendees, type NormalizedImportRow } from "@/lib/events/roster";
import { toE164 } from "@/lib/phone";
import { getCountries, type CountryCode } from "libphonenumber-js";

// Admin bulk-import of an event roster (U3). Accepts pasted text (or pre-split
// rows), parses + normalizes each row, calls the import_event_attendees RPC, and
// returns a per-row report. Helpers live in lib/ (roster-import parser, roster
// importAttendees wrapper) — App Router forbids non-handler exports from route.ts.

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

const VALID_COUNTRIES = new Set<string>(getCountries());

interface RowReport {
  /** 1-based original pasted line number. */
  line: number;
  raw: string;
  status: "inserted" | "merged" | "error";
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: eventId } = await params;

  let body: { text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "Missing 'text' (pasted rows)" }, { status: 400 });
  }

  // 1. Parse + validate the pasted text (pure, no DB).
  const { rows: parsed, errors: parseErrors } = parseImportRows(body.text);

  const reports: RowReport[] = parseErrors.map((e) => ({
    line: e.line,
    raw: e.raw,
    status: "error" as const,
    reason: e.reason,
  }));

  // 2. Normalize each parsed row's phone via lib/phone toE164. A phone that won't
  //    normalize for its country becomes a per-row error (never a 500). Email is
  //    lowercased by the parser. Track the source line so the RPC index maps back.
  const normalized: NormalizedImportRow[] = [];
  const lineByIndex: { line: number; raw: string }[] = [];

  for (const row of parsed) {
    let phoneE164: string | null = null;
    if (row.phone) {
      if (!VALID_COUNTRIES.has(row.country)) {
        reports.push({
          line: row.line,
          raw: `${row.name}, ${row.country}, ${row.phone}, ${row.email}`,
          status: "error",
          reason: `Unknown country code "${row.country}"`,
        });
        continue;
      }
      phoneE164 = toE164(row.phone, row.country as CountryCode);
      if (!phoneE164) {
        reports.push({
          line: row.line,
          raw: `${row.name}, ${row.country}, ${row.phone}, ${row.email}`,
          status: "error",
          reason: `Invalid phone "${row.phone}" for country ${row.country}`,
        });
        continue;
      }
    }

    normalized.push({
      name: row.name,
      email: row.email || null,
      phone_e164: phoneE164,
    });
    lineByIndex.push({ line: row.line, raw: `${row.name}, ${row.country}, ${row.phone}, ${row.email}` });
  }

  // 3. Call the RPC for the rows that survived parse + normalize.
  if (normalized.length > 0) {
    let results;
    try {
      results = await importAttendees(eventId, normalized);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Import failed" },
        { status: 500 }
      );
    }

    // An "Event not found" marker from the RPC surfaces as a 404 for the whole batch.
    if (results.length === 1 && results[0].status === "error" && results[0].message === "Event not found") {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    for (const r of results) {
      const src = lineByIndex[r.index];
      reports.push({
        line: src?.line ?? r.index + 1,
        raw: src?.raw ?? "",
        status: r.status,
        reason: r.message,
      });
    }
  }

  reports.sort((a, b) => a.line - b.line);

  const counts = {
    inserted: reports.filter((r) => r.status === "inserted").length,
    merged: reports.filter((r) => r.status === "merged").length,
    errors: reports.filter((r) => r.status === "error").length,
  };

  return NextResponse.json({ counts, rows: reports });
}
