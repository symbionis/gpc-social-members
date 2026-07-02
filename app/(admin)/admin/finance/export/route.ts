import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { getFinanceTransactions } from "@/lib/admin/finance";

// CSV export of settled financial transactions for a date range. Gated to the
// same roles as the finance page (super_admin + finance).
const ALLOWED_ROLES = ["super_admin", "finance"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function csvCell(value: string | number): string {
  // Numeric cells (amounts) are emitted as-is so spreadsheet SUMs still work —
  // they can't carry a formula-injection payload.
  if (typeof value === "number") return String(value);
  let s = value;
  // Neutralize spreadsheet formula injection: Excel/Sheets treat a cell that
  // begins with =, +, -, @, tab, or CR as a formula. Party/detail come from
  // user-controlled data (member/registrant names, event titles), so prefix a
  // single quote to force text interpretation.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Quote when the value contains a comma, quote, or newline; double embedded quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  if (!admins?.[0] || !ALLOWED_ROLES.includes(admins[0].role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const rows = await getFinanceTransactions(adminClient, from, to);

  const header = ["Type", "Date", "Party", "Detail", "Status", "Amount (CHF)"];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [r.type, r.date, r.party, r.detail, r.status, r.amountChf]
        .map(csvCell)
        .join(","),
    ),
  ];
  const csv = lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-${from}_to_${to}.csv"`,
    },
  });
}
