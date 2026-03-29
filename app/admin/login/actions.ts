"use server";

import { createClient } from "@/lib/supabase/server";

export async function sendAdminMagicLink(email: string, redirectTo: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}
