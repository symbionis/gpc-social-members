import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const body = await request.json();

  const updates: Record<string, unknown> = {
    first_name: body.first_name,
    last_name: body.last_name,
    phone: body.phone,
    company_name: body.company_name,
    company_role: body.company_role,
    address: body.address ?? null,
    profile_photo_url: body.profile_photo_url ?? undefined,
  };

  // Marketing consent is optional in the request body — only update when
  // the client supplied a boolean. Keeps the endpoint backwards-compatible
  // with callers that submit just the profile fields.
  if (typeof body.marketing_consent === "boolean") {
    updates.marketing_consent = body.marketing_consent;
  }

  const { error } = await adminClient
    .from("members")
    .update(updates)
    .eq("email", user.email);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
