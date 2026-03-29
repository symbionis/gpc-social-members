import { Suspense } from "react";
import NewPasswordForm from "./NewPasswordForm";

export default function NewPasswordPage() {
  return (
    <div className="min-h-screen bg-linen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl font-bold text-marine">
            Set New Password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground font-body">
            Choose a secure password for your account.
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-border p-8">
          <Suspense>
            <NewPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
