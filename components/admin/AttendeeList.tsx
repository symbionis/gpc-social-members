import { formatDateTime, formatCurrency } from "@/lib/format";

interface Attendee {
  id: string;
  name: string;
  email: string;
  is_member: boolean;
  quantity: number;
  total_amount_chf: number;
  status: string;
  reference_code: string;
  created_at: string;
  // Arrival is derived from the presence of an event_checkins row for this
  // registration — the single source of truth (checked_in_at is removed).
  checkedIn: boolean;
}

interface Props {
  attendees: Attendee[];
}

function amountLabel(status: string, total: number) {
  if (status === "free" || total === 0) return "Free";
  return formatCurrency(total, { decimals: 2 });
}

export default function AttendeeList({ attendees }: Props) {
  if (attendees.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
        No registrations yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead className="bg-cream/60 text-marine">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Name</th>
              <th className="text-left px-4 py-3 font-semibold">Email</th>
              <th className="text-left px-4 py-3 font-semibold">Member</th>
              <th className="text-left px-4 py-3 font-semibold">Tickets</th>
              <th className="text-left px-4 py-3 font-semibold">Amount</th>
              <th className="text-left px-4 py-3 font-semibold">Reference</th>
              <th className="text-left px-4 py-3 font-semibold">Registered</th>
              <th className="text-left px-4 py-3 font-semibold">Arrived</th>
            </tr>
          </thead>
          <tbody>
            {attendees.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3 text-marine">{row.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.email}</td>
                <td className="px-4 py-3">
                  {row.is_member ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">
                      Yes
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                      No
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-marine">{row.quantity}</td>
                <td className="px-4 py-3 text-marine">
                  {amountLabel(row.status, Number(row.total_amount_chf))}
                </td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                  {row.reference_code}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {formatDateTime(row.created_at)}
                </td>
                <td className="px-4 py-3">
                  {row.checkedIn ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">
                      In
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
