import { Suspense } from "react";
import ForgotPasswordForm from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-linen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl font-bold text-marine">
            Reset Password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground font-body">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-border p-8">
          <Suspense>
            <ForgotPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
