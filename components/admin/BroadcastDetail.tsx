"use client";

import Link from "next/link";
import { formatDateTime } from "@/lib/format";

export interface BroadcastDetailRow {
  id: string;
  subject: string;
  body_html: string;
  audience_filter: {
    status?: string;
    tier_id?: string | null;
    tier_ids?: string[] | null;
  } | null;
  channel: string;
  status: string;
  sent_at: string | null;
  recipient_count: number;
  error_count: number;
  created_at: string;
}

export interface RecipientRow {
  id: string;
  email: string;
  status: string;
  error: string | null;
  provider_message_id: string | null;
  created_at: string;
  member_name: string | null;
}

interface Props {
  broadcast: BroadcastDetailRow;
  recipients: RecipientRow[];
  tierMap: Record<string, string>;
}

export default function BroadcastDetail({
  broadcast,
  recipients,
  tierMap,
}: Props) {
  const sentCount = recipients.filter((r) => r.status === "sent").length;
  const failedCount = recipients.filter((r) => r.status === "failed").length;

  // Wrap the body in a minimal styled document so the sandboxed iframe
  // renders consistently with the composer preview. Sandboxed (no scripts,
  // no top navigation) per defence-in-depth even though only super_admins
  // can author broadcasts.
  const bodyDoc = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  body { margin: 0; padding: 24px; font-family: 'Poppins','Helvetica Neue',Arial,sans-serif; color: #052938; line-height: 1.65; font-size: 15px; }
  h1, h2, h3 { font-family: 'Playfair Display', Georgia, serif; }
  a { color: #052938; }
</style></head><body>${broadcast.body_html}</body></html>`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-marine">
            {broadcast.subject}
          </h1>
          <p className="text-sm font-body text-muted-foreground mt-1">
            {audienceLabel(broadcast.audience_filter, tierMap)} · sent{" "}
            {formatDateTime(broadcast.sent_at ?? broadcast.created_at)}
          </p>
        </div>
        <Link
          href="/admin/messages"
          className="text-sm font-body text-muted-foreground hover:text-marine"
        >
          ← Back
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Recipients" value={broadcast.recipient_count.toString()} />
        <Stat label="Sent" value={sentCount.toString()} tone="ok" />
        <Stat
          label="Failed"
          value={failedCount.toString()}
          tone={failedCount > 0 ? "bad" : "neutral"}
        />
      </div>

      <div>
        <h2 className="font-heading text-base font-semibold text-marine mb-2">
          Body
        </h2>
        <iframe
          title="Broadcast body"
          srcDoc={bodyDoc}
          sandbox=""
          className="w-full min-h-[400px] rounded-xl border border-border bg-white"
        />
      </div>

      <div>
        <h2 className="font-heading text-base font-semibold text-marine mb-2">
          Recipients
        </h2>
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-cream border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                    Member
                  </th>
                  <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recipients.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center font-body text-muted-foreground"
                    >
                      No recipients recorded.
                    </td>
                  </tr>
                )}
                {recipients.map((r) => (
                  <tr key={r.id} className="hover:bg-cream/50">
                    <td className="px-4 py-3 font-body text-marine">
                      {r.member_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-body text-muted-foreground">
                      {r.email}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-3 font-body text-red-600 text-xs">
                      {r.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "text-green-700"
      : tone === "bad"
        ? "text-red-600"
        : "text-marine";
  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="text-xs font-body text-muted-foreground">{label}</div>
      <div className={`text-2xl font-heading font-bold mt-1 ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    sent: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    skipped: "bg-gray-100 text-gray-600",
  };
  const cls = styles[status] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-body font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function audienceLabel(
  filter: BroadcastDetailRow["audience_filter"],
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

