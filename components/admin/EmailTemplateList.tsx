"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Template {
  templateId: number;
  alias: string | null;
  name: string;
  active: boolean;
}

interface EmailSetting {
  id: string;
  key: string;
  value: {
    days_before_expiry?: number;
    reminder_1_days?: number;
    reminder_2_days?: number;
    reminder_3_days?: number;
  } & Record<string, unknown>;
  enabled: boolean;
}

interface EmailTemplateListProps {
  templates: Template[];
  settings: EmailSetting[];
}

export default function EmailTemplateList({ templates, settings }: EmailTemplateListProps) {
  const router = useRouter();

  const autoRenewalSetting = settings.find((s) => s.key === "auto_renewal_reminder");
  const [autoRenewalEnabled, setAutoRenewalEnabled] = useState(
    autoRenewalSetting?.enabled ?? false
  );
  const [reminder1Days, setReminder1Days] = useState(
    autoRenewalSetting?.value?.reminder_1_days ?? autoRenewalSetting?.value?.days_before_expiry ?? 30
  );
  const [reminder2Days, setReminder2Days] = useState(
    autoRenewalSetting?.value?.reminder_2_days ?? 14
  );
  const [reminder3Days, setReminder3Days] = useState(
    autoRenewalSetting?.value?.reminder_3_days ?? 7
  );
  const expiryNotifSetting = settings.find((s) => s.key === "auto_expiry_notification");
  const [expiryNotifEnabled, setExpiryNotifEnabled] = useState(
    expiryNotifSetting?.enabled ?? true
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  async function handleSaveSettings() {
    setSavingSettings(true);
    setSettingsSaved(false);

    await Promise.all([
      fetch("/api/admin/email-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "auto_renewal_reminder",
          enabled: autoRenewalEnabled,
          value: {
            reminder_1_days: reminder1Days,
            reminder_2_days: reminder2Days,
            reminder_3_days: reminder3Days,
          },
        }),
      }),
      fetch("/api/admin/email-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "auto_expiry_notification",
          enabled: expiryNotifEnabled,
        }),
      }),
    ]);

    setSavingSettings(false);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  return (
    <div className="space-y-8">
      {/* Automated Email Settings */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h2 className="font-body font-semibold text-marine mb-4">Automated Emails</h2>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-6 p-4 rounded-lg border border-border">
            <div className="flex-1">
              <p className="font-body font-medium text-marine text-sm">Auto-Renewal Reminders</p>
              <p className="text-xs text-muted-foreground font-body mt-0.5">
                Sends <code className="bg-cream px-1 rounded text-xs">membership-expiring</code> email
                to active members whose card is expiring soon.
              </p>
              {autoRenewalEnabled && (
                <div className="mt-3 space-y-2">
                  {[
                    { label: "1st reminder", value: reminder1Days, setter: setReminder1Days },
                    { label: "2nd reminder", value: reminder2Days, setter: setReminder2Days },
                    { label: "3rd reminder", value: reminder3Days, setter: setReminder3Days },
                  ].map(({ label, value, setter }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-body w-24">{label}</span>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={value}
                        onChange={(e) => setter(Number(e.target.value))}
                        className="w-16 px-2 py-1 border border-border rounded text-sm font-body text-marine text-center"
                      />
                      <span className="text-xs text-muted-foreground font-body">days before expiry</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground font-body mt-1">Set to 0 to disable a stage.</p>
                </div>
              )}
            </div>
            <button
              onClick={() => setAutoRenewalEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                autoRenewalEnabled ? "bg-marine" : "bg-gray-200"
              }`}
              role="switch"
              aria-checked={autoRenewalEnabled}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                  autoRenewalEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          {/* Expiry Notification */}
          <div className="flex items-start justify-between gap-6 p-4 rounded-lg border border-border">
            <div className="flex-1">
              <p className="font-body font-medium text-marine text-sm">Membership Expired Notification</p>
              <p className="text-xs text-muted-foreground font-body mt-0.5">
                Sends <code className="bg-cream px-1 rounded text-xs">membership-expired</code> email
                when a membership is automatically expired, with a link to renew.
              </p>
            </div>
            <button
              onClick={() => setExpiryNotifEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                expiryNotifEnabled ? "bg-marine" : "bg-gray-200"
              }`}
              role="switch"
              aria-checked={expiryNotifEnabled}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                  expiryNotifEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
          >
            {savingSettings ? "Saving..." : "Save Settings"}
          </button>
          {settingsSaved && (
            <span className="text-sm text-green-700 font-body">Saved</span>
          )}
        </div>
      </div>

      {/* Link to Scheduled Jobs */}
      <div className="bg-cream/50 rounded-xl border border-border p-4 flex items-center justify-between">
        <p className="text-sm font-body text-muted-foreground">
          View job execution history and trigger manual runs on the{" "}
          <a href="/admin/scheduled-jobs" className="text-marine font-medium hover:underline">
            Scheduled Jobs
          </a>{" "}
          page.
        </p>
      </div>

      {/* Template List */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-body font-semibold text-marine">Postmark Templates</h2>
        </div>
        {templates.length === 0 ? (
          <div className="px-6 py-8 text-center text-muted-foreground font-body text-sm">
            No templates found. Check your Postmark configuration.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">Name</th>
                <th className="px-6 py-3 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">Alias</th>
                <th className="px-6 py-3 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.map((t) => (
                <tr key={t.templateId} className="hover:bg-cream/50 transition-colors">
                  <td className="px-6 py-4 font-body text-marine font-medium">{t.name}</td>
                  <td className="px-6 py-4 font-body text-muted-foreground">
                    {t.alias ? (
                      <code className="bg-cream px-1.5 py-0.5 rounded text-xs">{t.alias}</code>
                    ) : "—"}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-body ${
                      t.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                    }`}>
                      {t.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {t.alias ? (
                      <button
                        onClick={() => router.push(`/admin/email-templates/${t.alias}`)}
                        className="text-xs font-body text-sky-dark hover:underline"
                      >
                        Edit
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground font-body">No alias</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
