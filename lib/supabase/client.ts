import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Prefer build-time vars; fall back to data attributes injected by the Server
  // Component layout (handles Railway where NEXT_PUBLIC_ vars aren't available
  // at build time but are available at request time).
  const body = typeof document !== "undefined" ? document.body : null;
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    body?.dataset.supabaseUrl ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    body?.dataset.supabaseAnonKey ||
    "";

  return createBrowserClient(url, anonKey);
}
