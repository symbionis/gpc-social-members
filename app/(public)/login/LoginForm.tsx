"use client";

import { useState, useRef } from "react";
import { sendOtpCode, verifyOtpCode } from "@/app/actions/auth";
import { useSearchParams, useRouter } from "next/navigation";

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
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  async function handleVerifyCode(fullCode: string) {
    setLoading(true);
    setError(null);

    const result = await verifyOtpCode(email, fullCode, "member");
    setLoading(false);

    if (result.error) {
      setError(result.error);
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
      return;
    }

    if (result.redirect) {
      router.push(result.redirect);
    }
  }

  function handleCodeChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const fullCode = newCode.join("");
    if (fullCode.length === 6) {
      handleVerifyCode(fullCode);
    }
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
    const newCode = [...code];
    for (let i = 0; i < 6; i++) {
      newCode[i] = pasted[i] || "";
    }
    setCode(newCode);
    if (pasted.length === 6) {
      handleVerifyCode(pasted);
    } else {
      inputRefs.current[pasted.length]?.focus();
    }
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
            onClick={handleSendCode}
            disabled={loading}
            className="text-sm text-sky-dark hover:text-marine font-body underline disabled:opacity-50"
          >
            Resend code
          </button>
          <br />
          <button
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
