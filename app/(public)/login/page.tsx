import { Suspense } from "react";
import type { Metadata } from "next";
import LoginForm from "./LoginForm";

// KTD4: a members-only offer sends signed-out visitors here as
// /login?next=/public/offers/<token>, so this page's URL can carry the live
// emailed secret. Mirror the offer landing's own no-referrer policy so the
// token never rides out in a Referer header.
export const metadata: Metadata = { referrer: "no-referrer" };

export default function MemberLoginPage() {
  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="font-heading text-3xl font-bold text-marine">
              Member Login
            </h1>
            <p className="mt-2 text-muted-foreground font-body">
              Sign in to your Geneva Polo Club membership portal.
            </p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </>
  );
}
