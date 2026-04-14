"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Originator {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  invite_code: string | null;
  invite_link_active: boolean;
  can_invite_honorary: boolean;
}

interface Referral {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  originator_id: string;
}

interface AvailableAdmin {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface OriginatorListProps {
  originators: Originator[];
  referrals: Referral[];
  appUrl: string;
  isSuperAdmin: boolean;
  availableAdmins: AvailableAdmin[];
  honoraryCode: string;
}

export default function OriginatorList({
  originators,
  referrals,
  appUrl,
  isSuperAdmin,
  availableAdmins,
  honoraryCode: initialHonoraryCode,
}: OriginatorListProps) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedAdminId, setSelectedAdminId] = useState("");
  const [honoraryCode, setHonoraryCode] = useState(initialHonoraryCode);
  const [savingHonorary, setSavingHonorary] = useState(false);
  const [honorarySaved, setHonorarySaved] = useState(false);

  function copyLink(inviteCode: string) {
    navigator.clipboard.writeText(`${appUrl}/apply/${inviteCode}`);
    setCopied(inviteCode);
    setTimeout(() => setCopied(null), 2000);
  }

  const selectedAdmin = availableAdmins.find((a) => a.id === selectedAdminId);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedAdmin) {
      setError("Please select an admin user");
      return;
    }
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/originators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: selectedAdmin.first_name,
        last_name: selectedAdmin.last_name,
        email: selectedAdmin.email,
        invite_code: form.get("invite_code"),
        can_invite_honorary: form.get("can_invite_honorary") === "on",
      }),
    });

    if (res.ok) {
      setShowForm(false);
      setSelectedAdminId("");
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to create originator");
    }
    setSaving(false);
  }

  async function toggleHonorary(id: string, current: boolean) {
    setTogglingId(id);
    await fetch("/api/admin/originators", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, can_invite_honorary: !current }),
    });
    router.refresh();
    setTogglingId(null);
  }

  async function toggleActive(id: string, current: boolean) {
    setTogglingId(id);
    await fetch("/api/admin/originators", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, invite_link_active: !current }),
    });
    router.refresh();
    setTogglingId(null);
  }

  async function handleSaveHonoraryCode() {
    setSavingHonorary(true);
    setHonorarySaved(false);
    await fetch("/api/admin/email-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "honorary_invite_code",
        value: { code: honoraryCode },
      }),
    });
    setSavingHonorary(false);
    setHonorarySaved(true);
    setTimeout(() => setHonorarySaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Honorary Invite Code */}
      {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-body font-semibold text-marine mb-1">Honorary Invite Code</h2>
          <p className="text-xs text-muted-foreground font-body mb-4">
            Append <code className="bg-cream px-1 rounded">?hono=CODE</code> to any originator link to enable honorary signup.
          </p>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              value={honoraryCode}
              onChange={(e) => setHonoraryCode(e.target.value)}
              placeholder="e.g. HONORARY-2026"
              className="flex-1 px-3 py-2 border border-border rounded-lg font-body text-sm text-marine focus:outline-none focus:ring-2 focus:ring-sky/50"
            />
            <button
              onClick={handleSaveHonoraryCode}
              disabled={savingHonorary}
              className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
            >
              {savingHonorary ? "Saving..." : "Save"}
            </button>
            {honorarySaved && (
              <span className="text-sm text-green-700 font-body">Saved</span>
            )}
          </div>
          {honoraryCode && (
            <p className="text-xs text-muted-foreground font-body">
              Example: <code className="bg-cream px-1 rounded text-xs">{appUrl}/apply/ORIGINATOR?hono={honoraryCode}</code>
            </p>
          )}
        </div>
      )}

      {/* Create button — super_admin only */}
      {isSuperAdmin && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-marine text-white text-sm font-body rounded-md hover:bg-marine-light transition-colors"
        >
          Add Originator
        </button>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h3 className="font-body font-semibold text-marine text-lg mb-4">
            New Originator
          </h3>
          {error && (
            <p className="text-sm text-destructive font-body mb-4">{error}</p>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-body text-marine mb-1">
                Admin User
              </label>
              {availableAdmins.length > 0 ? (
                <select
                  value={selectedAdminId}
                  onChange={(e) => setSelectedAdminId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-border rounded-md font-body text-sm focus:ring-2 focus:ring-sky/50 focus:outline-none"
                >
                  <option value="">Select an admin user...</option>
                  {availableAdmins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.first_name} {a.last_name} — {a.email}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-muted-foreground font-body py-2">
                  All admin users are already originators.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-body text-marine mb-1">
                Invite Code
              </label>
              <input
                name="invite_code"
                required
                placeholder="e.g. JOHN-GPC-2026"
                className="w-full px-3 py-2 border border-border rounded-md font-body text-sm focus:ring-2 focus:ring-sky/50 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="can_invite_honorary"
                className="w-4 h-4 rounded border-border text-marine focus:ring-sky"
              />
              <span className="text-sm font-body text-marine">
                Can invite Honorary Members
              </span>
            </label>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-marine text-white text-sm font-body rounded-md hover:bg-marine-light transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Create Originator"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
                className="px-4 py-2 border border-border text-marine text-sm font-body rounded-md hover:bg-cream transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Originator cards */}
      {originators.map((orig) => {
        const myReferrals = referrals.filter(
          (r) => r.originator_id === orig.id
        );
        const inviteLink = `${appUrl}/apply/${orig.invite_code}`;

        return (
          <div
            key={orig.id}
            className="bg-white rounded-xl border border-border p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-body font-semibold text-marine text-lg">
                  {orig.first_name} {orig.last_name}
                </h3>
                <p className="text-sm text-muted-foreground font-body">
                  {orig.email}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  {orig.can_invite_honorary && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-body">
                      Honorary
                    </span>
                  )}
                  {!orig.invite_link_active && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-body">
                      Link Inactive
                    </span>
                  )}
                </div>
              </div>
              <span className="px-3 py-1 bg-sky/10 text-sky-dark rounded-full text-sm font-body font-medium">
                {myReferrals.length} referral
                {myReferrals.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Invite link */}
            {orig.invite_code && (
              <div className="bg-cream rounded-lg p-3 mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground font-body mb-0.5">
                    Invite link
                  </p>
                  <p className="text-sm font-body text-marine truncate">
                    {inviteLink}
                  </p>
                </div>
                <button
                  onClick={() => copyLink(orig.invite_code!)}
                  className="shrink-0 px-3 py-1.5 bg-marine text-white text-xs font-body rounded-md hover:bg-marine-light transition-colors"
                >
                  {copied === orig.invite_code ? "Copied!" : "Copy"}
                </button>
              </div>
            )}

            {/* Super admin toggles */}
            {isSuperAdmin && (
              <div className="flex flex-wrap gap-3 mb-4">
                <button
                  onClick={() => toggleHonorary(orig.id, orig.can_invite_honorary)}
                  disabled={togglingId === orig.id}
                  className="px-3 py-1.5 border border-border text-xs font-body rounded-md hover:bg-cream transition-colors disabled:opacity-50"
                >
                  {orig.can_invite_honorary
                    ? "Revoke Honorary Access"
                    : "Enable Honorary Invites"}
                </button>
                <button
                  onClick={() => toggleActive(orig.id, orig.invite_link_active)}
                  disabled={togglingId === orig.id}
                  className="px-3 py-1.5 border border-border text-xs font-body rounded-md hover:bg-cream transition-colors disabled:opacity-50"
                >
                  {orig.invite_link_active
                    ? "Deactivate Link"
                    : "Activate Link"}
                </button>
              </div>
            )}

            {/* Referred members */}
            {myReferrals.length > 0 && (
              <div>
                <p className="text-sm font-body font-medium text-marine mb-2">
                  Referred Members
                </p>
                <div className="space-y-1">
                  {myReferrals.map((ref) => (
                    <div
                      key={ref.id}
                      className="flex items-center justify-between text-sm py-1"
                    >
                      <span className="font-body text-marine">
                        {ref.first_name} {ref.last_name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-body ${
                          ref.status === "active"
                            ? "bg-green-100 text-green-800"
                            : ref.status === "pending"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {ref.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {originators.length === 0 && !showForm && (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground font-body">
            No originators configured yet.
          </p>
        </div>
      )}
    </div>
  );
}
