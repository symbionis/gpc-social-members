"use client";

import Link from "next/link";

export interface BroadcastRow {
  id: string;
  subject: string;
  audience_filter: {
    status?: string;
    tier_id?: string | null;
    tier_ids?: string[] | null;
  } | null;
  recipient_count: number;
  error_count: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

interface Props {
  broadcasts: BroadcastRow[];
  tierMap: Record<string, string>;
}

export default function BroadcastList({ broadcasts, tierMap }: Props) {
  if (broadcasts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground font-body mb-4">
          No broadcasts yet.
        </p>
        <Link
          href="/admin/messages/new"
          className="inline-block px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
        >
          New broadcast
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-cream border-b border-border">
              <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                Subject
              </th>
              <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                Audience
              </th>
              <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                Recipients
              </th>
              <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                Errors
              </th>
              <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                Sent
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {broadcasts.map((b) => (
              <tr key={b.id} className="hover:bg-cream/50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/messages/${b.id}`}
                    className="font-body font-medium text-marine hover:underline"
                  >
                    {b.subject}
                  </Link>
                  {b.status !== "sent" && (
                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                      {b.status}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-body text-muted-foreground">
                  {audienceLabel(b.audience_filter, tierMap)}
                </td>
                <td className="px-4 py-3 font-body text-marine">
                  {b.recipient_count}
                </td>
                <td className="px-4 py-3 font-body text-marine">
                  {b.error_count > 0 ? (
                    <span className="text-red-600">{b.error_count}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 font-body text-muted-foreground">
                  {formatDate(b.sent_at ?? b.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function audienceLabel(
  filter: BroadcastRow["audience_filter"],
  tierMap: Record<string, string>
): string {
  if (!filter) return "—";
  const status = filter.status ?? "all";
  const statusLabel =
    status === "all"
      ? "All members"
      : status === "active"
        ? "Active members"
        : status === "expired"
          ? "Expired members"
          : status;
  const tierIds = filter.tier_ids && filter.tier_ids.length > 0
    ? filter.tier_ids
    : filter.tier_id
      ? [filter.tier_id]
      : [];
  if (tierIds.length === 0) return statusLabel;
  const names = tierIds.map((id) => tierMap[id] ?? "tier");
  return `${statusLabel} · ${names.join(", ")}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
