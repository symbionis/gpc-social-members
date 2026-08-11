"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import CredentialScanner from "./CredentialScanner";
import PhoneInput from "@/components/common/PhoneInput";
import WaiverModal from "@/components/events/WaiverModal";

interface CheckinResult {
  status: string;
  name?: string | null;
  ticket_type_title?: string | null;
  checked_in_at?: string | null;
}

type Phase = "scan" | "busy" | "needs_name" | "needs_waiver" | "result";

// The guest-facing waiver copy that used to live here moved into WaiverModal, which the
// roster path renders too — one component, so the two door surfaces cannot present the same
// legal document differently.

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
  const [error, setError] = useState<string | null>(null);
  // The phase the in-flight request was launched from — where a failure returns to, and what
  // keeps the waiver modal mounted while its own submit is in flight.
  const [submittedFrom, setSubmittedFrom] = useState<Phase>("scan");

  // Reset to a fresh scan (keeps the modal open — used by "Scan next guest").
  const resetFields = useCallback(() => {
    setPhase("scan");
    setToken("");
    setResult(null);
    setName("");
    setEmail("");
    setPhone(null);
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

  // `from` is the phase this attempt was launched in, and a failure lands back there.
  //
  // It used to fall back to `extra.name ? "needs_name" : "scan"`, which sent a failed WAIVER
  // submit to the scanner — and on a scanned, already-named ticket `name` is "", so even the
  // guest-details case missed. Dropping out of the waiver discards what the guest just did:
  // the modal unmounts, its state resets, and they have to read and tick the whole thing
  // again while the queue waits. Landing back on needs_waiver keeps the acceptance on screen
  // with the error inside the modal, so "try again" is one tap.
  const submit = useCallback(
    async (raw: string, extra: Record<string, unknown> = {}, from: Phase = "scan") => {
      setSubmittedFrom(from);
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

        // Parsed defensively: a 500 from the framework or a 502 from a proxy can carry JSON
        // with no `error` key, or no JSON at all.
        let data: (CheckinResult & { error?: string }) | null = null;
        try {
          data = (await res.json()) as CheckinResult & { error?: string };
        } catch (err) {
          console.error("[door/scan] response was not JSON", { status: res.status, err });
        }

        // `!res.ok` alone. This was `!res.ok && data.error`, so a non-ok response without an
        // `error` key skipped this branch entirely, fell through to setResult(), and landed on
        // the result screen — where ResultCard's fallback reads "Ticket not recognised". The
        // operator was told the guest's QR was bad when it was the server that failed.
        if (!res.ok) {
          setError(data?.error || "Something went wrong. Try again.");
          setPhase(from);
          return;
        }

        if (data?.status === "needs_name") {
          setResult(data);
          setPhase("needs_name");
          return;
        }
        if (data?.status === "needs_waiver") {
          setResult(data);
          setPhase("needs_waiver");
          return;
        }
        // Only a real outcome reaches the result screen. An unknown status is the server
        // saying something this screen cannot read, which must not be shown to an operator as
        // a verdict about the guest's ticket.
        if (data?.status === "checked_in" || data?.status === "already" || data?.status === "not_recognised") {
          setResult(data);
          setPhase("result");
          // A scan is a check-in: pull the roster and the arrivals counts forward now
          // rather than leaving them stale until the console's 20s poll fires.
          if (data.status === "checked_in") router.refresh();
          return;
        }
        console.error("[door/scan] unrecognised status from the route", { status: data?.status });
        setError("Something went wrong. Try again, or find the guest by name in the roster.");
        setPhase(from);
      } catch {
        setError("Could not reach the server. Try again.");
        setPhase(from);
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
                        submit(
                          token,
                          {
                            name: name.trim(),
                            email: email.trim(),
                            phone: phone ?? "",
                          },
                          "needs_name"
                        )
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

              {/* The waiver is the shared WaiverModal, not a phase-local block: the roster
                  path raises the same one. Two presentations of a legal document agreed on the
                  text but had already diverged on the chrome and the acceptance gesture, and the
                  recorded WAIVER_VERSION cannot tell them apart. */}
              {/* Stays mounted across its OWN submit. `open={phase === "needs_waiver"}` alone
                  unmounted it the instant submit set "busy" — so `busy` could never be true,
                  the guest got no in-flight feedback, and a failure discarded their acceptance
                  along with the component's state. */}
              <WaiverModal
                open={
                  phase === "needs_waiver" ||
                  (phase === "busy" && submittedFrom === "needs_waiver")
                }
                guestName={result?.name ?? name.trim()}
                busy={phase === "busy"}
                error={error}
                onClose={closeScanner}
                onAccept={({ language, marketingConsent }) =>
                  submit(
                    token,
                    {
                      name: name.trim(),
                      email: email.trim(),
                      phone: phone ?? "",
                      waiverAccepted: true,
                      language,
                      marketingConsent,
                    },
                    "needs_waiver"
                  )
                }
              />

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
