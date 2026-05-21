"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { formatDateTime } from "@/lib/format";
import {
  type EventMessageKind,
  computeCanSend,
  isBodyEmpty,
  buildSendConfirm,
} from "@/components/admin/event-messaging-state";

import type { ReminderSummaryRow } from "@/lib/events/reminder-summary";
export type { ReminderSummaryRow };

export interface SentMessageRow {
  id: string;
  subject: string;
  kind: string;
  recipient_count: number;
  error_count: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

interface Props {
  eventId: string;
  reminders: ReminderSummaryRow[];
  sentMessages: SentMessageRow[];
}

const KIND_LABEL: Record<string, string> = {
  event_pre: "Pre-event",
  event_post: "Post-event",
};

const AUDIENCE_HINT: Record<EventMessageKind, string> = {
  event_pre: "Goes to everyone registered for this event (regardless of marketing consent).",
  event_post: "Goes to everyone who checked in. By default only those who opted in at the door.",
};

export default function EventMessaging({ eventId, reminders, sentMessages }: Props) {
  const router = useRouter();

  const [kind, setKind] = useState<EventMessageKind>("event_pre");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [includeNonConsented, setIncludeNonConsented] = useState(false);

  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const [fetchingCount, setFetchingCount] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reused across retries of the same compose attempt so a lost-response retry
  // de-duplicates server-side; regenerated after a successful send.
  const idemRef = useRef<string | null>(null);

  const fetchCount = useCallback(async () => {
    setFetchingCount(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/messages/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, include_non_consented: includeNonConsented }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not load recipient count.");
        setRecipientCount(null);
      } else {
        setRecipientCount(data.recipient_count);
        setSkippedCount(data.skipped_count ?? 0);
      }
    } catch {
      setError("Network error loading recipient count.");
      setRecipientCount(null);
    } finally {
      setFetchingCount(false);
    }
  }, [eventId, kind, includeNonConsented]);

  // Refetch the count whenever the audience or override changes (AE4). Subject
  // and body changes do not invalidate the count.
  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const subjectEmpty = !subject.trim();
  const bodyEmpty = isBodyEmpty(bodyHtml);
  const canSend = computeCanSend({ subjectEmpty, bodyEmpty, recipientCount, fetchingCount, sending });

  function selectKind(next: EventMessageKind) {
    setKind(next);
    if (next === "event_pre") setIncludeNonConsented(false);
    setNotice(null);
  }

  async function handleSend() {
    if (recipientCount === null || recipientCount === 0) return;
    if (!window.confirm(buildSendConfirm({ subject, kind, recipientCount, includeNonConsented }))) {
      return;
    }
    setError(null);
    setNotice(null);
    setSending(true);
    if (!idemRef.current) idemRef.current = crypto.randomUUID();
    try {
      const res = await fetch(`/api/admin/events/${eventId}/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          subject,
          body_html: bodyHtml,
          include_non_consented: includeNonConsented,
          idempotency_key: idemRef.current,
        }),
      });
      const data = await res.json();

      if (res.status === 409) {
        setError(data.error || "A message for this event is already being sent.");
        setSending(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Send failed.");
        setSending(false);
        return;
      }

      try {
        posthog.capture("event_message_sent", {
          event_id: eventId,
          kind,
          recipient_count: data.recipient_count,
          failed: data.failed,
          include_non_consented: includeNonConsented,
        });
      } catch {
        /* posthog not initialized — ignore */
      }

      if (data.deduplicated) {
        setNotice("This message was already sent.");
      } else if (data.failed > 0) {
        setNotice(`Sent to ${data.sent}, failed for ${data.failed} — see Messages sent below.`);
      } else {
        setNotice(`Sent to ${data.sent} recipient${data.sent === 1 ? "" : "s"}.`);
      }

      // Successful attempt: reset the composer and the idempotency key, and
      // refresh the server data (Messages sent + counts).
      idemRef.current = null;
      setSubject("");
      setBodyHtml("");
      setSending(false);
      router.refresh();
    } catch {
      setError("Network error sending the message.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div>
          <label className="block text-xs font-body text-muted-foreground mb-1">Audience</label>
          <select
            value={kind}
            onChange={(e) => selectKind(e.target.value as EventMessageKind)}
            className="w-full max-w-sm px-3 py-2.5 rounded-lg border border-border bg-white text-marine font-body text-sm"
            aria-label="Message audience"
          >
            <option value="event_pre">Pre-event — registered attendees</option>
            <option value="event_post">Post-event — checked-in attendees</option>
          </select>
          <p className="mt-1 text-[11px] font-body text-muted-foreground">{AUDIENCE_HINT[kind]}</p>
        </div>

        {kind === "event_post" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
            <label className="flex items-start gap-2 text-sm font-body text-marine cursor-pointer">
              <input
                type="checkbox"
                checked={includeNonConsented}
                onChange={(e) => setIncludeNonConsented(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-sky-dark focus:ring-sky/50"
              />
              <span>
                Send to all check-ins, including those who didn&rsquo;t opt in
                <span className="block text-[11px] text-muted-foreground">
                  Use only for operational messages — this bypasses marketing consent.
                </span>
              </span>
            </label>
          </div>
        )}

        <div>
          <label className="block text-xs font-body text-muted-foreground mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="A short, scannable subject line"
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>

        <div>
          <label className="block text-xs font-body text-muted-foreground mb-1">Message</label>
          <RichTextEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            placeholder="Write to attendees…"
          />
          <p className="mt-2 text-xs font-body text-muted-foreground">
            The message sends exactly as written, wrapped in the club email
            template. Personalisation placeholders are not substituted — write
            the greeting directly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {sending
              ? "Sending…"
              : recipientCount !== null
                ? `Send to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`
                : "Send"}
          </button>
          <span className="text-xs font-body text-muted-foreground">
            {fetchingCount
              ? "Counting recipients…"
              : recipientCount !== null
                ? `${recipientCount} recipient${recipientCount === 1 ? "" : "s"}${
                    kind === "event_post" && !includeNonConsented && skippedCount > 0
                      ? ` · ${skippedCount} skipped (no consent)`
                      : ""
                  }`
                : ""}
          </span>
        </div>

        {error && <p className="text-sm font-body text-red-600">{error}</p>}
        {notice && (
          <p className="text-sm font-body text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}
      </section>

      <section>
        <h3 className="font-body font-semibold text-marine mb-3">Messages sent</h3>
        {sentMessages.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">
            No messages have been sent for this event yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-border/60 bg-white">
            <table className="min-w-full text-sm font-body">
              <thead className="bg-cream/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">When</th>
                  <th className="px-4 py-2 text-left">Audience</th>
                  <th className="px-4 py-2 text-left">Subject</th>
                  <th className="px-4 py-2 text-left">Recipients</th>
                </tr>
              </thead>
              <tbody>
                {sentMessages.map((m) => (
                  <tr key={m.id} className="border-t border-border/60">
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {formatDateTime(m.sent_at ?? m.created_at)}
                    </td>
                    <td className="px-4 py-2 text-marine">{KIND_LABEL[m.kind] ?? m.kind}</td>
                    <td className="px-4 py-2 text-marine">{m.subject}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {m.recipient_count}
                      {m.error_count > 0 ? ` · ${m.error_count} failed` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="font-body font-semibold text-marine mb-3">Reminders sent</h3>
        {reminders.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">
            No reminders have been sent for this event yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-border/60 bg-white">
            <table className="min-w-full text-sm font-body">
              <thead className="bg-cream/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">When</th>
                  <th className="px-4 py-2 text-left">Timing</th>
                  <th className="px-4 py-2 text-left">Slot</th>
                  <th className="px-4 py-2 text-left">Recipients</th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((r) => (
                  <tr key={`${r.days_before}|${r.slot}`} className="border-t border-border/60">
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {formatDateTime(r.last_sent_at)}
                    </td>
                    <td className="px-4 py-2 text-marine">
                      {r.days_before === 0
                        ? "Day of event"
                        : `${r.days_before} day${r.days_before === 1 ? "" : "s"} before`}
                    </td>
                    <td className="px-4 py-2 text-marine capitalize">{r.slot}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.recipient_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
