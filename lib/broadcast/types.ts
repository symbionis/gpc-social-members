import type { MemberStatus } from "@/types/database";

/** Filter that the audience resolver translates into a recipient list. */
export interface AudienceFilter {
  /** Member status — currently `active` | `expired` | `all`. Other values are
   *  rejected at the route layer. */
  status: MemberStatus | "all";
  /** Optional tier ids to narrow within a status. Empty/omitted = any tier. */
  tier_ids?: string[] | null;
}

/** A single recipient passed to a channel adapter. */
export interface BroadcastRecipient {
  member_id: string;
  email: string;
  first_name: string;
  last_name: string;
  /** Membership tier name at send time (null if the member has no tier set). */
  tier_name: string | null;
}

/** The content snapshot that the adapter renders for each recipient. */
export interface BroadcastContent {
  subject: string;
  body_html: string;
  /** Optional plain-text fallback. If omitted, the channel may strip HTML. */
  body_text?: string;
}

/** Per-recipient delivery result. The adapter never throws on individual
 *  recipient failures — it returns a result row so the orchestrator can
 *  persist a complete audit trail. */
export interface RecipientResult {
  member_id: string;
  email: string;
  status: "sent" | "failed";
  error?: string;
  provider_message_id?: string;
}

/** Channel-agnostic broadcast adapter. Future channels (WhatsApp, SMS) plug
 *  in by implementing this same interface. */
export interface BroadcastChannel {
  readonly key: "email"; // widen to a union as channels are added
  send(
    recipients: BroadcastRecipient[],
    content: BroadcastContent
  ): Promise<RecipientResult[]>;
}
