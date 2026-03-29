import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

// Member magic link callback — member dashboard takes priority over admin
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    (() => {
      const proto = request.headers.get("x-forwarded-proto") ?? "https";
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      return `${proto}://${host}`;
    })();
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  if (!token_hash && !code) {
    return NextResponse.redirect(
      `${origin}/login?error=expired&message=Your+login+link+has+expired.+Please+request+a+new+one.`
    );
  }

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    authError = error;
  } else {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return response;
  }

  const adminClient = createAdminClient();

  // Link auth_user_id in both tables if needed
  const [{ data: members }, { data: adminUsers }] = await Promise.all([
    adminClient.from("members").select("id, auth_user_id").eq("email", user.email).limit(1),
    adminClient.from("admin_users").select("id, auth_user_id").eq("email", user.email).limit(1),
  ]);

  const member = members?.[0];
  const adminUser = adminUsers?.[0];

  if (member && !member.auth_user_id) {
    await adminClient.from("members").update({ auth_user_id: user.id }).eq("id", member.id);
  }
  if (adminUser && !adminUser.auth_user_id) {
    await adminClient.from("admin_users").update({ auth_user_id: user.id }).eq("id", adminUser.id);
  }

  // Member portal takes priority — this is the member login path
  if (member) {
    response.headers.set("Location", `${origin}/dashboard`);
    return response;
  }

  // Fallback to admin if no member record
  if (adminUser) {
    response.headers.set("Location", `${origin}/admin/dashboard`);
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
