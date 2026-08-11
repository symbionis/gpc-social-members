"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { sendOtpCode, verifyOtpCode } from "@/app/actions/auth";
import { useSearchParams, useRouter } from "next/navigation";
import posthog from "posthog-js";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const errorParam = searchParams.get("error");
  const message = searchParams.get("message");
  const paymentSuccess = searchParams.get("payment") === "success";
  // U5: carries a signed-out offer holder back to the offer landing after
  // sign-in. Validated server-side in verifyOtpCode (safeOfferReturnPath) —
  // this is just a pass-through of an untrusted query param.
  const next = searchParams.get("next");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // The code we've already sent to the server, so a re-render can't submit the
  // same six digits twice. Cleared whenever the code stops being complete.
  const submittedCodeRef = useRef<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await sendOtpCode(email);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setStep("code");
  }

  const handleVerifyCode = useCallback(async function handleVerifyCode(fullCode: string) {
    setLoading(true);
    setError(null);

    const result = await verifyOtpCode(email, fullCode, "member", next);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
      return;
    }

    if (result.redirect) {
      if (result.identity) {
        // Tie this browser session (pageviews, autocapture) to the signed-in
        // user. Guarded so a posthog failure can never block the redirect.
        try {
          posthog.identify(result.identity.distinctId, {
            email: result.identity.email,
            account_type: result.identity.accountType,
            role: result.identity.role,
            member_id: result.identity.memberId,
          });
        } catch {
          /* analytics must never block login navigation */
        }
      }
      router.push(result.redirect);
    }
  }, [email, next, router]);

  // Auto-submit is driven off settled state rather than off whichever handler
  // happened to receive the last digit, so typing, pasting and OS autofill all
  // converge on one submission path.
  useEffect(() => {
    const fullCode = code.join("");
    if (fullCode.length !== 6) {
      submittedCodeRef.current = null;
      return;
    }
    if (submittedCodeRef.current === fullCode) return;
    submittedCodeRef.current = fullCode;
    handleVerifyCode(fullCode);
  }, [code, handleVerifyCode]);

  // Write a run of digits into the boxes starting at `index`. iOS hands a
  // one-time-code autofill to the *first* box as the whole six-digit string
  // rather than one digit per box, so a change event has to be able to carry
  // more than one digit; the old `value.slice(-1)` kept the last one and
  // silently dropped the other five, leaving the form looking untouched.
  // Merging via a functional update keeps concurrent events from clobbering
  // each other's digits.
  function fillFrom(index: number, digits: string) {
    setCode((prev) => {
      const next = [...prev];
      for (let i = 0; i < digits.length && index + i < 6; i++) {
        next[index + i] = digits[i];
      }
      return next;
    });
    // A stale "invalid code" must not sit under the boxes while a new one is entered.
    setError(null);
    inputRefs.current[Math.min(index + digits.length, 5)]?.focus();
  }

  function handleCodeChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;

    if (value === "") {
      setCode((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      setError(null);
      return;
    }

    fillFrom(index, value);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    // Same path as an autofill; the effect above submits once it's complete.
    fillFrom(0, pasted);
  }

  if (step === "code") {
    return (
      <div className="text-center space-y-6">
        <div className="w-14 h-14 bg-sky/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-sky-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <h2 className="font-heading text-xl font-bold text-marine">Enter your code</h2>
          <p className="mt-2 text-sm text-muted-foreground font-body">
            We sent a 6-digit code to <span className="font-medium text-marine">{email}</span>
          </p>
        </div>

        <div className="flex justify-center gap-2" onPaste={handlePaste}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              // iOS offers the emailed code to the first box only; without this
              // attribute the OS never surfaces the autofill prompt at all.
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading}
              className="w-12 h-14 text-center text-xl font-bold rounded-lg border border-border bg-white text-marine font-body focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky disabled:opacity-50"
              autoFocus={i === 0}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive font-body">{error}</p>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground font-body">Verifying...</p>
        )}

        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={handleSendCode}
            disabled={loading}
            className="text-sm text-sky-dark hover:text-marine font-body underline disabled:opacity-50"
          >
            Resend code
          </button>
          <br />
          <button
            type="button"
            onClick={() => { setStep("email"); setCode(["", "", "", "", "", ""]); setError(null); }}
            className="text-sm text-muted-foreground hover:text-marine font-body underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {paymentSuccess && (
        <div className="mb-6 p-5 bg-green-50 border border-green-200 rounded-lg text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p className="font-heading text-lg font-bold text-marine mb-1">Payment confirmed!</p>
          <p className="text-sm text-muted-foreground font-body">
            Your membership is now active. Sign in below to discover the clubhouse.
          </p>
        </div>
      )}

      {errorParam && message && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
          {decodeURIComponent(message)}
        </div>
      )}

      <form onSubmit={handleSendCode} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="your@email.com"
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
        {error && (
          <p className="text-sm text-destructive font-body">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Sending code..." : "Send Sign-In Code"}
        </button>
        <p className="text-xs text-center text-muted-foreground font-body">
          We&apos;ll email you a 6-digit code for a password-free sign in.
        </p>
      </form>
    </>
  );
}
