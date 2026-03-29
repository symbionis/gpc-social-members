import { NextResponse } from "next/server";

// Temporary diagnostic — remove after debugging
export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "MISSING",
    supabaseAnonKeyPrefix: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.slice(0, 20) + "..."
      : "MISSING",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "MISSING",
    nodeEnv: process.env.NODE_ENV,
  });
}
