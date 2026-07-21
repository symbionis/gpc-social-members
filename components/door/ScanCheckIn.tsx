"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import CredentialScanner from "./CredentialScanner";
import PhoneInput from "@/components/common/PhoneInput";
import WaiverText from "@/components/events/WaiverText";
import type { WaiverLanguage } from "@/lib/events/waiver";

interface CheckinResult {
  status: string;
  name?: string | null;
  ticket_type_title?: string | null;
  checked_in_at?: string | null;
}

type Phase = "scan" | "busy" | "needs_name" | "needs_waiver" | "result";

// Guest-facing copy for the waiver step (we hand the phone to the guest here), in the
// language they pick with the EN/FR toggle. The waiver body itself comes from WaiverText.
const WAIVER_COPY: Record<
  WaiverLanguage,
  { title: string; intro: string; accept: string; comms: string; button: string }
> = {
  en: {
    title: "Waiver",
    intro: "Please read and accept the waiver to check in.",
    accept: "I have read and accept the waiver above.",
    comms: "I'd like to receive news and invitations from Geneva Polo Social Club.",
    button: "Accept & check in",
  },
  fr: {
    title: "Décharge",
    intro: "Merci de lire et d'accepter la décharge pour l'enregistrement.",
    accept: "J'ai lu et j'accepte la décharge ci-dessus.",
    comms: "Je souhaite recevoir les actualités et invitations du Geneva Polo Social Club.",
    button: "Accepter et enregistrer",
  },
};

const bigField =
  "w-full rounded-xl border-2 border-marine/30 bg-white px-4 py-4 text-lg font-body text-marine placeholder:text-marine/40 focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";
const labelText = "mb-1.5 block font-body text-base font-semibold text-marine";
const primaryBtn =
  "w-full rounded-xl bg-marine px-5 py-4 text-lg font-body font-semibold text-white hover:bg-marine-light transition-colors disabled:opacity-50 cursor-pointer";
const secondaryBtn =
  "w-full rounded-xl border-2 border-marine/30 px-5 py-4 text-lg font-body font-semibold text-marine hover:bg-marine/5 transition-colors cursor-pointer";

function timeLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ScanCheckIn({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("scan");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [language, setLanguage] = useState<WaiverLanguage>("en");
  const [waiverChecked, setWaiverChecked] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to a fresh scan (keeps the modal open — used by "Scan next guest").
  const resetFields = useCallback(() => {
    setPhase("scan");
    setToken("");
    setResult(null);
    setName("");
    setEmail("");
    setPhone(null);
    setLanguage("en");
    setWaiverChecked(false);
    setMarketingConsent(true);
    setError(null);
  }, []);

  const openScanner = useCallback(() => {
    resetFields();
    setOpen(true);
  }, [resetFields]);

  const closeScanner = useCallback(() => {
    setOpen(false);
    resetFields();
  }, [resetFields]);

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
        else {
          setPhase("result");
          // A scan is a check-in: pull the roster and the arrivals counts forward now
          // rather than leaving them stale until the console's 20s poll fires.
          if (data.status === "checked_in") router.refresh();
        }
      } catch {
        setError("Could not reach the server. Try again.");
        setPhase("scan");
      }
    },
    [eventId, router]
  );

  const onDecode = useCallback(
    (value: string) => {
      setToken(value);
      void submit(value);
    },
    [submit]
  );

  // Every guest must give a contact (email OR phone).
  const canContinue =
    name.trim() !== "" && (email.trim() !== "" || Boolean(phone));
  const copy = WAIVER_COPY[language];

  return (
    <>
      <button
        type="button"
        onClick={openScanner}
        className="w-full rounded-2xl bg-marine px-6 py-7 text-center shadow-sm transition-colors hover:bg-marine-light cursor-pointer"
      >
        <span className="block font-heading text-2xl font-bold text-white">Scan a ticket</span>
        <span className="mt-1 block font-body text-base text-white/80">
          Tap to open the camera and check a guest in
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-cream">
          <div className="flex items-center justify-between border-b border-border bg-white px-5 py-4">
            <h2 className="font-heading text-lg font-bold text-marine">Check in a guest</h2>
            <button
              type="button"
              onClick={closeScanner}
              className="rounded-lg px-3 py-2 font-body text-base font-semibold text-marine transition-colors hover:bg-marine/5 cursor-pointer"
            >
              ✕ Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-6">
            <div className="mx-auto max-w-md">
              {phase === "scan" && (
                <div className="space-y-4">
                  <CredentialScanner
                    active
                    onDecode={onDecode}
                    videoClassName="h-[55vh] w-full object-cover"
                  />
                  <p className="text-center font-body text-base text-marine/70">
                    Point the camera at the guest’s QR code.
                  </p>
                  {error && (
                    <p className="text-center font-body text-base text-red-700">{error}</p>
                  )}
                  <button type="button" onClick={closeScanner} className={secondaryBtn}>
                    Close
                  </button>
                </div>
              )}

              {phase === "busy" && (
                <p className="py-16 text-center font-body text-lg text-marine/70">Checking…</p>
              )}

              {phase === "needs_name" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="font-heading text-xl font-bold text-marine">Guest details</h3>
                    <p className="mt-1 font-body text-base text-marine/70">
                      {result?.ticket_type_title ? `${result.ticket_type_title} · ` : ""}
                      Please enter your details to check in.
                    </p>
                  </div>
                  <div>
                    <label className={labelText} htmlFor="scan-name">
                      Name
                    </label>
                    <input
                      id="scan-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      autoFocus
                      autoComplete="off"
                      className={bigField}
                    />
                  </div>
                  <div>
                    <label className={labelText} htmlFor="scan-email">
                      Email
                    </label>
                    <input
                      id="scan-email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      inputMode="email"
                      autoComplete="off"
                      className={bigField}
                    />
                  </div>
                  <div>
                    <label className={labelText} htmlFor="phone">
                      Phone
                    </label>
                    <PhoneInput large onChange={setPhone} />
                  </div>
                  <p className="font-body text-base text-marine/60">
                    Enter at least an email or a phone number.
                  </p>
                  {error && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-body text-base text-red-700">
                      {error}
                    </p>
                  )}
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={!canContinue}
                      onClick={() =>
                        submit(token, {
                          name: name.trim(),
                          email: email.trim(),
                          phone: phone ?? "",
                        })
                      }
                      className={primaryBtn}
                    >
                      Continue
                    </button>
                    <button type="button" onClick={closeScanner} className={secondaryBtn}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {phase === "needs_waiver" && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-heading text-xl font-bold text-marine">{copy.title}</h3>
                    <div className="flex gap-2">
                      {(["en", "fr"] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setLanguage(l)}
                          className={`rounded-lg border-2 px-4 py-2 font-body text-base font-semibold transition-colors ${
                            language === l
                              ? "border-marine bg-marine text-white"
                              : "border-marine/30 text-marine/60"
                          }`}
                        >
                          {l.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="font-body text-base text-marine/70">
                    {result?.name ? `${result.name} — ` : ""}
                    {copy.intro}
                  </p>
                  <WaiverText lang={language} textSize="text-base" maxHeightClass="max-h-[40vh]" />

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={waiverChecked}
                      onChange={(e) => setWaiverChecked(e.target.checked)}
                      className="mt-1 h-7 w-7 shrink-0 accent-marine cursor-pointer"
                    />
                    <span className="font-body text-base font-medium text-marine">
                      {copy.accept}
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={marketingConsent}
                      onChange={(e) => setMarketingConsent(e.target.checked)}
                      className="mt-1 h-7 w-7 shrink-0 accent-marine cursor-pointer"
                    />
                    <span className="font-body text-base text-marine/70">{copy.comms}</span>
                  </label>

                  {error && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-body text-base text-red-700">
                      {error}
                    </p>
                  )}
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={!waiverChecked}
                      onClick={() =>
                        submit(token, {
                          name: name.trim(),
                          email: email.trim(),
                          phone: phone ?? "",
                          waiverAccepted: true,
                          language,
                          marketingConsent,
                        })
                      }
                      className={primaryBtn}
                    >
                      {copy.button}
                    </button>
                    <button type="button" onClick={closeScanner} className={secondaryBtn}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {phase === "result" && result && (
                <div className="space-y-4">
                  <ResultCard result={result} />
                  <button type="button" onClick={resetFields} className={primaryBtn}>
                    Scan next guest
                  </button>
                  <button type="button" onClick={closeScanner} className={secondaryBtn}>
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ResultCard({ result }: { result: CheckinResult }) {
  if (result.status === "checked_in") {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center">
        <p className="font-heading text-2xl font-bold text-emerald-900">Checked in ✓</p>
        <p className="mt-1 font-body text-lg text-emerald-900/80">
          {result.name || "Guest"}
          {result.ticket_type_title ? ` · ${result.ticket_type_title}` : ""}
        </p>
        <p className="mt-2 font-body text-base text-emerald-900/70">Hand over the bracelet.</p>
      </div>
    );
  }
  if (result.status === "already") {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center">
        <p className="font-heading text-xl font-bold text-amber-900">Already checked in</p>
        <p className="mt-1 font-body text-lg text-amber-900/80">
          {result.name || "Guest"} arrived at {timeLabel(result.checked_in_at)} — no second
          bracelet.
        </p>
      </div>
    );
  }
  if (result.status === "not_for_event") {
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-6 text-center">
        <p className="font-heading text-xl font-bold text-red-900">Ticket for another event</p>
        <p className="mt-1 font-body text-lg text-red-900/80">This QR isn’t for this event.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-marine/5 p-6 text-center">
      <p className="font-heading text-xl font-bold text-marine">Ticket not recognised</p>
      <p className="mt-1 font-body text-lg text-marine/70">
        Try again, or find the guest by name in the roster.
      </p>
    </div>
  );
}
