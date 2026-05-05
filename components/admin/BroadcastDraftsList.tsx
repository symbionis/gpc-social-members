"use client";

import Link from "next/link";

export interface DraftRow {
  id: string;
  subject: string;
  audience_filter: {
    status?: string;
    tier_id?: string | null;
    tier_ids?: string[] | null;
  } | null;
  recipient_count: number;
  created_at: string;
}

interface Props {
  drafts: DraftRow[];
  tierMap: Record<string, string>;
}

export default function BroadcastDraftsList({ drafts, tierMap }: Props) {
  if (drafts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground font-body mb-4">
          No drafts yet. Start a new broadcast and click Save draft to keep
          it for later.
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
                Recipients (now)
              </th>
              <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                Last updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {drafts.map((d) => (
              <tr key={d.id} className="hover:bg-cream/50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/messages/drafts/${d.id}/edit`}
                    className="font-body font-medium text-marine hover:underline"
                  >
                    {d.subject || (
                      <span className="italic text-muted-foreground">
                        Untitled draft
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 font-body text-muted-foreground">
                  {audienceLabel(d.audience_filter, tierMap)}
                </td>
                <td className="px-4 py-3 font-body text-marine">
                  {d.recipient_count}
                </td>
                <td className="px-4 py-3 font-body text-muted-foreground">
                  {formatDate(d.created_at)}
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
  filter: DraftRow["audience_filter"],
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
