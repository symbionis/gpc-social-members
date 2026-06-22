"use client";

import { useCallback, useState } from "react";
import CredentialScanner from "./CredentialScanner";

interface CheckinResult {
  status: string;
  name?: string | null;
  ticket_type_title?: string | null;
  checked_in_at?: string | null;
  is_child?: boolean;
}

type Phase = "scan" | "busy" | "needs_name" | "needs_waiver" | "result";

function timeLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ScanCheckIn({ eventId }: { eventId: string }) {
  const [phase, setPhase] = useState<Phase>("scan");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase("scan");
    setToken("");
    setResult(null);
    setName("");
    setEmail("");
    setPhone("");
    setLanguage("en");
    setError(null);
  }, []);

  const submit = useCallback(
    async (raw: string, extra: Record<string, unknown> = {}) => {
      setPhase("busy");
      setError(null);
      try {
        const res = await fetch(`/api/public/door/${eventId}/check-in`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: raw, ...extra }),
          // Don't strand the scanner on "Checking…" if the RPC hangs (mirrors the
          // door console's save/check-in timeouts).
          signal: AbortSignal.timeout(10000),
        });
        const data = (await res.json()) as CheckinResult & { error?: string };
        if (!res.ok && data.error) {
          setError(data.error);
          setPhase(extra.name ? "needs_name" : "scan");
          return;
        }
        setResult(data);
        if (data.status === "needs_name") setPhase("needs_name");
        else if (data.status === "needs_waiver") setPhase("needs_waiver");
        else setPhase("result");
      } catch {
        setError("Could not reach the server. Try again.");
        setPhase("scan");
      }
    },
    [eventId]
  );

  const onDecode = useCallback(
    (value: string) => {
      setToken(value);
      void submit(value);
    },
    [submit]
  );

  return (
    <div className="rounded-2xl border border-marine/20 bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-heading text-base font-bold text-marine">Scan a ticket</h2>

      {phase === "scan" && (
        <>
          <CredentialScanner active onDecode={onDecode} />
          <p className="mt-2 text-center font-body text-xs text-marine/60">
            Point the camera at the guest’s QR code.
          </p>
          {error && <p className="mt-2 text-center font-body text-xs text-red-600">{error}</p>}
        </>
      )}

      {phase === "busy" && (
        <p className="py-8 text-center font-body text-sm text-marine/70">Checking…</p>
      )}

      {phase === "needs_name" && (
        <div className="space-y-3">
          <p className="font-body text-sm text-marine">
            This ticket has no name yet
            {result?.ticket_type_title ? ` · ${result.ticket_type_title}` : ""}. Enter the
            guest’s name.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest name"
            autoFocus
            className="w-full rounded-lg border border-border/60 px-3 py-2 text-sm font-body"
          />
          {!result?.is_child && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                inputMode="email"
                className="w-full rounded-lg border border-border/60 px-3 py-2 text-sm font-body"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (optional)"
                inputMode="tel"
                className="w-full rounded-lg border border-border/60 px-3 py-2 text-sm font-body"
              />
            </div>
          )}
          {error && <p className="font-body text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => submit(token, { name, email, phone })}
              className="rounded-lg bg-marine px-4 py-2 text-sm font-body font-semibold text-white disabled:opacity-50"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-border/60 px-4 py-2 text-sm font-body text-marine"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "needs_waiver" && (
        <div className="space-y-3">
          <p className="font-body text-sm text-marine">
            {result?.name ? `${result.name} hasn’t` : "This guest hasn’t"} accepted the waiver.
            Confirm they accept it to check in.
          </p>
          <div className="flex gap-2 text-xs font-body">
            {(["en", "fr"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={`rounded-lg border px-3 py-1 ${
                  language === l ? "border-marine bg-marine/10 text-marine" : "border-border/60 text-marine/60"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {error && <p className="font-body text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                submit(token, { name, email, phone, waiverAccepted: true, language })
              }
              className="rounded-lg bg-marine px-4 py-2 text-sm font-body font-semibold text-white"
            >
              Waiver accepted — check in
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-border/60 px-4 py-2 text-sm font-body text-marine"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "result" && result && (
        <div className="space-y-3">
          <ResultCard result={result} />
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-lg bg-marine px-4 py-2 text-sm font-body font-semibold text-white"
          >
            Scan next
          </button>
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: CheckinResult }) {
  if (result.status === "checked_in") {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center">
        <p className="font-heading text-lg font-bold text-emerald-900">Checked in ✓</p>
        <p className="font-body text-sm text-emerald-900/80">
          {result.name || "Guest"}
          {result.ticket_type_title ? ` · ${result.ticket_type_title}` : ""}
        </p>
        <p className="mt-1 font-body text-xs text-emerald-900/70">Hand over the bracelet.</p>
      </div>
    );
  }
  if (result.status === "already") {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-center">
        <p className="font-heading text-base font-bold text-amber-900">Already checked in</p>
        <p className="font-body text-sm text-amber-900/80">
          {result.name || "Guest"} arrived at {timeLabel(result.checked_in_at)} — no second
          bracelet.
        </p>
      </div>
    );
  }
  if (result.status === "not_for_event") {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-center">
        <p className="font-heading text-base font-bold text-red-900">Ticket for another event</p>
        <p className="font-body text-sm text-red-900/80">This QR isn’t for this event.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border/60 bg-marine/5 p-4 text-center">
      <p className="font-heading text-base font-bold text-marine">Ticket not recognised</p>
      <p className="font-body text-sm text-marine/70">
        Try again, or find the guest by name in the roster below.
      </p>
    </div>
  );
}
