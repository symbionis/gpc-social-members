import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

// PKCE token exchange callback for magic link
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as "email" | "magiclink",
    });

    if (!error) {
      // Successfully verified — redirect to callback to determine destination
      return NextResponse.redirect(`${origin}/auth/callback`);
    }
  }

  // Verification failed — redirect to login with error
  return NextResponse.redirect(
    `${origin}/login?error=expired&message=Your+login+link+has+expired.+Please+request+a+new+one.`
  );
}
