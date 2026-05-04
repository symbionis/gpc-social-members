"use client";

import { useState, useRef } from "react";
import { sendOtpCode, verifyOtpCode } from "@/app/actions/auth";
import { useSearchParams, useRouter } from "next/navigation";

export default function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const errorParam = searchParams.get("error");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  async function handleSendCode(e?: React.FormEvent) {
    e?.preventDefault();
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

    const result = await verifyOtpCode(email, fullCode, "admin");
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
          <svg className="w-7 h-7 text-sky-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Enter your code</h2>
          <p className="mt-2 text-sm text-white/70 font-body">
            We sent a 6-digit code to <span className="font-medium text-white">{email}</span>
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
              className="w-12 h-14 text-center text-xl font-bold rounded-lg border border-white/20 bg-white/10 text-white font-body focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky disabled:opacity-50"
              autoFocus={i === 0}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-300 font-body">{error}</p>
        )}

        {loading && (
          <p className="text-sm text-white/70 font-body">Verifying...</p>
        )}

        <div className="space-y-2 pt-2">
          <button
            onClick={() => handleSendCode()}
            disabled={loading}
            className="text-sm text-sky-light hover:text-white font-body underline disabled:opacity-50"
          >
            Resend code
          </button>
          <br />
          <button
            onClick={() => { setStep("email"); setCode(["", "", "", "", "", ""]); setError(null); }}
            className="text-sm text-white/50 hover:text-white font-body underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {errorParam === "unauthorized" && (
        <div className="mb-6 p-4 bg-white/10 border border-white/20 rounded-lg text-sm text-white/80 font-body">
          You do not have admin access. Please contact a super administrator.
        </div>
      )}

      <form onSubmit={handleSendCode} className="space-y-4">
        <div>
          <label
            htmlFor="admin-email"
            className="block text-sm font-body font-medium text-white/80 mb-1.5"
          >
            Admin email address
          </label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="admin@genevapolo.com"
            className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 text-white font-body text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
        {error && (
          <p className="text-sm text-red-300 font-body">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-sky text-marine rounded-lg font-body font-medium text-sm hover:bg-sky-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Sending code..." : "Send Sign-In Code"}
        </button>
      </form>
    </>
  );
}
