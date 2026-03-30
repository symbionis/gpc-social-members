import { Suspense } from "react";
import LoginForm from "./LoginForm";

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
