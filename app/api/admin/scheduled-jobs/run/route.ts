import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_REGISTRY, withJobLogging } from "@/lib/cron/job-registry";
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
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("role")
    .eq("email", user.email)
    .limit(1);

  if (admins?.[0]?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const jobKey = body.job_key;

  if (!jobKey || typeof jobKey !== "string" || !JOB_REGISTRY[jobKey]) {
    return NextResponse.json(
      { error: "Unknown job key" },
      { status: 400 }
    );
  }

  try {
    const job = JOB_REGISTRY[jobKey];
    const result = await withJobLogging(jobKey, job.run, "manual");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
