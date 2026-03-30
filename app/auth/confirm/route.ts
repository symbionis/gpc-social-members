import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

// Auth callback — handles both:
//   ?token_hash=...&type=... (magic link OTP flow)
//   ?code=...               (PKCE authorization code flow)
// Also handles post-auth routing (admin vs member) in one step
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // APP_URL is a runtime env var (not inlined at build like NEXT_PUBLIC_APP_URL)
  const origin =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (() => {
      const proto = request.headers.get("x-forwarded-proto") ?? "https";
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      return `${proto}://${host}`;
    })();
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const from = searchParams.get("from"); // "admin" or "member"

  if (!token_hash && !code) {
    return NextResponse.redirect(
      `${origin}/login?error=expired&message=Your+login+link+has+expired.+Please+request+a+new+one.`
    );
  }

  // Create a response we can set cookies on
  const response = NextResponse.redirect(`${origin}/login`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  let authError = null;

  if (code) {
    // PKCE authorization code flow (Supabase default email provider)
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    authError = error;
  } else {
    // Magic link OTP flow (custom SMTP / token_hash)
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token_hash!,
      type: (type ?? "magiclink") as "email" | "magiclink",
    });
    authError = error;
  }

  if (authError) {
    return NextResponse.redirect(
      `${origin}/login?error=expired&message=Your+login+link+has+expired.+Please+request+a+new+one.`
    );
  }

  // Password recovery — send to set-new-password page (session already established)
  if (type === "recovery") {
    response.headers.set("Location", `${origin}/auth/new-password`);
    return response;
  }

  // Get the authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return response; // redirects to /login
  }

  const adminClient = createAdminClient();

  // Link auth_user_id in both tables if needed
  const { data: adminUsers } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, role")
    .eq("email", user.email)
    .limit(1);

  const adminUser = adminUsers?.[0];
  if (adminUser && !adminUser.auth_user_id) {
    await adminClient
      .from("admin_users")
      .update({ auth_user_id: user.id })
      .eq("id", adminUser.id);
  }

  const { data: members } = await adminClient
    .from("members")
    .select("id, auth_user_id")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (member && !member.auth_user_id) {
    await adminClient
      .from("members")
      .update({ auth_user_id: user.id })
      .eq("id", member.id);
  }

  // Route based on where login was initiated
  if (from === "admin" && adminUser) {
    const adminDest = adminUser.role === "originator" ? "/admin/originators" : "/admin/dashboard";
    response.headers.set("Location", `${origin}${adminDest}`);
    return response;
  }

  if (from === "member" && member) {
    response.headers.set("Location", `${origin}/dashboard`);
    return response;
  }

  // Fallback: no "from" param (e.g. old links) — prefer admin if exists
  if (adminUser) {
    const adminDest = adminUser.role === "originator" ? "/admin/originators" : "/admin/dashboard";
    response.headers.set("Location", `${origin}${adminDest}`);
    return response;
  }

  if (member) {
    response.headers.set("Location", `${origin}/dashboard`);
    return response;
  }

  // No account found
  await supabase.auth.signOut();
  response.headers.set(
    "Location",
    `${origin}/login?error=no_account&message=No+membership+found+for+this+email.`
  );
  return response;
}
