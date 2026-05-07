/**
 * Response shapes for the `/api/agent/*` surface.
 *
 * Exported so the agent (and any future internal caller) can `import type`
 * these and so that route handlers get compile-time guarantees that the
 * JSON they emit matches the documented contract.
 *
 * Convention: every error response uses `AgentApiError` and carries a
 * non-empty `error` string. Successful responses are flat objects (no
 * `data:` wrapper) keyed to the resource being returned.
 */

export interface AgentApiError {
  error: string;
}

// --- Read endpoints ---------------------------------------------------------

export interface AgentEventListItem {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  location: string | null;
  description: string | null;
  image_url: string | null;
  image_url_2: string | null;
  images: unknown;
  visibility: string;
  is_published: boolean;
  is_confirmed: boolean;
  registration_enabled: boolean;
  price_member: number | null;
  price_non_member: number | null;
  event_type_id: string;
  season_id: string | null;
}

export interface EventsListResponse {
  events: AgentEventListItem[];
  limit: number;
  offset: number;
}

export interface AgentBroadcastListItem {
  id: string;
  subject: string;
  status: string;
  audience_filter: unknown;
  recipient_count: number;
  error_count: number;
  skipped_count: number;
  created_at: string;
  sent_at: string | null;
  channel: string;
}

export interface BroadcastsListResponse {
  broadcasts: AgentBroadcastListItem[];
  limit: number;
  offset: number;
}

export interface AgentTier {
  id: string;
  name: string;
  slug: string;
  category: string;
  price_eur: number;
  is_active: boolean;
  sort_order: number;
}

export interface AgentEventType {
  id: string;
  name: string;
  slug: string;
  color: string;
  sort_order: number;
}

export interface AgentSeason {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface LookupsResponse {
  tiers: AgentTier[];
  event_types: AgentEventType[];
  current_season: AgentSeason | null;
}

// --- Audience preview -------------------------------------------------------

export interface AudienceTierBreakdown {
  tier_name: string | null;
  count: number;
}

export interface AudiencePreviewResponse {
  recipient_count: number;
  skipped_count: number;
  per_tier: AudienceTierBreakdown[];
}

// --- Draft writes -----------------------------------------------------------

export interface BroadcastDraftCreatedResponse {
  broadcast_id: string;
  edit_url: string;
}

export interface EventDraftCreatedResponse {
  event_id: string;
  edit_url: string;
}

export interface EventUpdatedResponse {
  event_id: string;
  updated_fields: string[];
}
