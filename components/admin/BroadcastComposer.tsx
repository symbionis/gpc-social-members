"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import RichTextEditor from "@/components/admin/RichTextEditor";

interface Tier {
  id: string;
  name: string;
}

type Status = "all" | "active" | "expired";

export interface InitialDraft {
  id: string;
  subject: string;
  body_html: string;
  audience_filter: {
    status?: string;
    tier_id?: string | null;
    tier_ids?: string[] | null;
  } | null;
}

interface Props {
  tiers: Tier[];
  initialDraft?: InitialDraft;
}

export default function BroadcastComposer({ tiers, initialDraft }: Props) {
  const router = useRouter();

  const initialStatus: Status = (() => {
    const s = initialDraft?.audience_filter?.status;
    return s === "all" || s === "expired" ? s : "active";
  })();
  const initialTierIds: string[] = (() => {
    const f = initialDraft?.audience_filter;
    if (!f) return [];
    if (Array.isArray(f.tier_ids) && f.tier_ids.length > 0) return f.tier_ids;
    if (typeof f.tier_id === "string" && f.tier_id.length > 0)
      return [f.tier_id];
    return [];
  })();

  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(initialDraft?.body_html ?? "");
  const [status, setStatus] = useState<Status>(initialStatus);
  const [tierIds, setTierIds] = useState<string[]>(initialTierIds);

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [skippedCount, setSkippedCount] = useState<number>(0);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bodyEmpty =
    !bodyHtml || bodyHtml.replace(/<[^>]+>/g, "").trim().length === 0;
  const subjectEmpty = !subject.trim();
  const canPreview = !subjectEmpty && !bodyEmpty;
  const canSend = canPreview && previewHtml !== null;
  const canSaveDraft = !subjectEmpty || !bodyEmpty;

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    try {
      const res = await fetch("/api/admin/broadcasts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body_html: bodyHtml,
          audience_filter: { status, tier_ids: tierIds },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to render preview.");
      } else {
        setPreviewHtml(data.html);
        setRecipientCount(data.recipient_count);
        setSkippedCount(data.skipped_count ?? 0);
      }
    } catch (e) {
      setError("Network error generating preview.");
      console.error(e);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSaveDraft() {
    setError(null);
    setSavingDraft(true);
    const payload = {
      subject,
      body_html: bodyHtml,
      audience_filter: { status, tier_ids: tierIds },
    };
    try {
      const url = draftId
        ? `/api/admin/broadcasts/drafts/${draftId}`
        : "/api/admin/broadcasts/drafts";
      const res = await fetch(url, {
        method: draftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save draft.");
        return;
      }
      const newId: string = data.broadcast_id;
      const wasNew = !draftId;
      setDraftId(newId);
      setDraftSavedAt(new Date());
      try {
        posthog.capture(
          wasNew ? "broadcast_draft_created" : "broadcast_draft_updated",
          { broadcast_id: newId }
        );
      } catch {
        /* posthog not initialized — ignore */
      }
      if (wasNew) {
        // Move the URL onto the edit route so a refresh reloads the draft.
        router.replace(`/admin/messages/drafts/${newId}/edit`);
      }
    } catch (e) {
      setError("Network error saving draft.");
      console.error(e);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSend() {
    if (recipientCount === null || recipientCount === 0) {
      setError("No recipients match this audience.");
      return;
    }
    const audienceLabel = audienceSummary(status, tierIds, tiers);
    if (
      !window.confirm(
        `Send "${subject}" to ${recipientCount} member${recipientCount === 1 ? "" : "s"} (${audienceLabel})?`
      )
    ) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/admin/broadcasts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body_html: bodyHtml,
          audience_filter: { status, tier_ids: tierIds },
          ...(draftId ? { broadcast_id: draftId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Send failed.");
        setSending(false);
        return;
      }
      try {
        posthog.capture("broadcast_draft_sent", {
          broadcast_id: data.broadcast_id,
          from_draft: Boolean(draftId),
        });
      } catch {
        /* posthog not initialized — ignore */
      }
      router.push(`/admin/messages/${data.broadcast_id}`);
    } catch (e) {
      setError("Network error sending broadcast.");
      console.error(e);
      setSending(false);
    }
  }

  async function handleDiscard() {
    if (!draftId) {
      router.push("/admin/messages");
      return;
    }
    if (!window.confirm("Discard this draft? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/admin/broadcasts/drafts/${draftId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to discard draft.");
        return;
      }
      try {
        posthog.capture("broadcast_draft_discarded", {
          broadcast_id: draftId,
        });
      } catch {
        /* posthog not initialized — ignore */
      }
      router.push("/admin/messages?tab=drafts");
    } catch (e) {
      setError("Network error discarding draft.");
      console.error(e);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setPreviewHtml(null);
          }}
          placeholder="A short, scannable subject line"
          className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
        />
      </div>

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">
          Message
        </label>
        <RichTextEditor
          value={bodyHtml}
          onChange={(html) => {
            setBodyHtml(html);
            setPreviewHtml(null);
          }}
          placeholder="Write to members…"
        />
        <div className="mt-2 text-xs font-body text-muted-foreground">
          <p className="mb-1">Available variables (paste into subject or message):</p>
          <ul className="space-y-0.5">
            <li>
              <code className="px-1.5 py-0.5 rounded bg-cream text-marine">
                {"{{first_name}}"}
              </code>{" "}
              — recipient&rsquo;s first name
            </li>
            <li>
              <code className="px-1.5 py-0.5 rounded bg-cream text-marine">
                {"{{last_name}}"}
              </code>{" "}
              — recipient&rsquo;s last name
            </li>
            <li>
              <code className="px-1.5 py-0.5 rounded bg-cream text-marine">
                {"{{tier_name}}"}
              </code>{" "}
              — recipient&rsquo;s membership tier
            </li>
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-body text-muted-foreground mb-1">
            Audience — status
          </label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status);
              setPreviewHtml(null);
            }}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-marine font-body text-sm"
          >
            <option value="active">Active members</option>
            <option value="expired">Expired members</option>
            <option value="all">All members (any status)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-body text-muted-foreground mb-1">
            Audience — tier (optional, multi-select)
          </label>
          <div className="rounded-lg border border-border bg-white px-3 py-2 max-h-40 overflow-y-auto">
            {tiers.length === 0 ? (
              <p className="text-xs font-body text-muted-foreground py-1">
                No tiers available.
              </p>
            ) : (
              <ul className="space-y-1">
                {tiers.map((t) => {
                  const checked = tierIds.includes(t.id);
                  return (
                    <li key={t.id}>
                      <label className="flex items-center gap-2 text-sm font-body text-marine cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setTierIds((prev) =>
                              e.target.checked
                                ? [...prev, t.id]
                                : prev.filter((id) => id !== t.id)
                            );
                            setPreviewHtml(null);
                          }}
                          className="h-4 w-4 rounded border-border text-sky-dark focus:ring-sky/50"
                        />
                        <span>{t.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="mt-1 text-[11px] font-body text-muted-foreground">
            Leave all unchecked to include any tier.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSaveDraft}
          disabled={!canSaveDraft || savingDraft || sending}
          className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors disabled:opacity-50"
        >
          {savingDraft
            ? "Saving…"
            : draftId
              ? "Update draft"
              : "Save draft"}
        </button>
        <button
          onClick={handlePreview}
          disabled={!canPreview || previewing || sending}
          className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors disabled:opacity-50"
        >
          {previewing ? "Rendering…" : "Preview"}
        </button>
        <button
          onClick={handleSend}
          disabled={!canSend || sending}
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
        >
          {sending
            ? "Sending…"
            : recipientCount !== null
              ? `Send to ${recipientCount} member${recipientCount === 1 ? "" : "s"}`
              : "Send"}
        </button>
        {draftId && (
          <button
            onClick={handleDiscard}
            disabled={sending || savingDraft}
            className="px-3 py-2 text-sm font-body text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            Discard draft
          </button>
        )}
        {recipientCount !== null && (
          <span className="text-xs font-body text-muted-foreground">
            {audienceSummary(status, tierIds, tiers)}
            {skippedCount > 0 &&
              ` · ${skippedCount} skipped (no marketing consent)`}
          </span>
        )}
        {draftSavedAt && (
          <span className="text-xs font-body text-muted-foreground">
            Draft saved at {draftSavedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm font-body text-red-600">{error}</p>
      )}

      {previewHtml && (
        <div>
          <p className="text-xs font-body text-muted-foreground mb-2">
            Preview (banner and chrome are an approximation — final email
            rendered by Postmark)
          </p>
          <iframe
            title="Broadcast preview"
            srcDoc={previewHtml}
            sandbox=""
            className="w-full min-h-[600px] rounded-lg border border-border bg-white"
          />
        </div>
      )}
    </div>
  );
}

function audienceSummary(
  status: Status,
  tierIds: string[],
  tiers: Tier[]
): string {
  const statusLabel =
    status === "all"
      ? "all members"
      : status === "active"
        ? "active members"
        : "expired members";
  if (tierIds.length === 0) return statusLabel;
  const names = tierIds
    .map((id) => tiers.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return statusLabel;
  return `${statusLabel} on ${names.join(", ")}`;
}
