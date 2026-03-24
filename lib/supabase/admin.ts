import { createClient } from "@supabase/supabase-js";

// Service role client — bypasses RLS for admin/webhook operations.
// No Database generic — avoids strict type issues with service role operations.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
