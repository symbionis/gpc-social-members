"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Template {
  alias: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

interface EmailTemplateEditorProps {
  template: Template;
}

type Tab = "html" | "text";

export default function EmailTemplateEditor({ template }: EmailTemplateEditorProps) {
  const router = useRouter();
  const [subject, setSubject] = useState(template.subject);
  const [htmlBody, setHtmlBody] = useState(template.htmlBody);
  const [textBody, setTextBody] = useState(template.textBody);
  const [activeTab, setActiveTab] = useState<Tab>("html");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);

    const res = await fetch(`/api/admin/email-templates/${template.alias}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, htmlBody, textBody }),
    });

    setSaving(false);
    if (res.ok) {
      setSaveResult({ success: true, message: "Template saved successfully." });
    } else {
      const data = await res.json();
      setSaveResult({ success: false, message: data.error || "Failed to save template." });
    }
  }

  return (
    <div className="space-y-6">
      {/* Subject */}
      <div className="bg-white rounded-xl border border-border p-6">
        <label className="block text-xs font-body uppercase tracking-wide text-muted-foreground mb-2">
          Subject Line
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body text-marine focus:outline-none focus:ring-1 focus:ring-sky"
        />
      </div>

      {/* Body editor */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab("html")}
            className={`px-5 py-3 text-sm font-body transition-colors ${
              activeTab === "html"
                ? "text-marine border-b-2 border-marine -mb-px"
                : "text-muted-foreground hover:text-marine"
            }`}
          >
            HTML Body
          </button>
          <button
            onClick={() => setActiveTab("text")}
            className={`px-5 py-3 text-sm font-body transition-colors ${
              activeTab === "text"
                ? "text-marine border-b-2 border-marine -mb-px"
                : "text-muted-foreground hover:text-marine"
            }`}
          >
            Text Body
          </button>
        </div>
        <div className="p-4">
          {activeTab === "html" ? (
            <textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              rows={20}
              className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono text-marine focus:outline-none focus:ring-1 focus:ring-sky resize-y"
              spellCheck={false}
            />
          ) : (
            <textarea
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
              rows={20}
              className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono text-marine focus:outline-none focus:ring-1 focus:ring-sky resize-y"
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {/* Variable reference */}
      <div className="bg-cream rounded-xl border border-border p-4 text-xs font-body text-muted-foreground">
        <p className="font-medium text-marine mb-1">Template Variables</p>
        <p>
          Use <code className="bg-white px-1 rounded">{"{{variable_name}}"}</code> for simple values.
          For URL buttons, wrap in <code className="bg-white px-1 rounded">{"{{#url_var}}...{{.}}...{{/url_var}}"}</code> (Postmark Mustachio block scope).
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Template"}
        </button>
        <button
          onClick={() => router.push("/admin/email-templates")}
          className="px-6 py-2.5 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors"
        >
          Cancel
        </button>
        {saveResult && (
          <span className={`text-sm font-body ${saveResult.success ? "text-green-700" : "text-red-600"}`}>
            {saveResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
