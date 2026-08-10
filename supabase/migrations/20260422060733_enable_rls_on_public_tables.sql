-- RECOVERED 2026-08-10 from supabase_migrations.schema_migrations (statements column).
-- Applied 2026-04-22, never committed. Recorded version stamp preserved, so
-- `db push` treats it as already applied and will not re-run it.

alter table public.renewal_tokens enable row level security;
alter table public.email_settings enable row level security;
alter table public.lounge_sessions enable row level security;
alter table public.event_types enable row level security;
alter table public.events enable row level security;
