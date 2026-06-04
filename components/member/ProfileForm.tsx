"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PhoneInput from "@/components/common/PhoneInput";

interface Address {
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

interface ProfileFormProps {
  member: {
    id: string;
    auth_user_id: string | null;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    company_name: string | null;
    company_role: string | null;
    address: Address | null;
    profile_photo_url: string | null;
    marketing_consent: boolean;
  };
}

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Bolivia", "Bosnia and Herzegovina",
  "Brazil", "Bulgaria", "Cambodia", "Canada", "Chile", "China", "Colombia", "Croatia",
  "Cyprus", "Czech Republic", "Denmark", "Ecuador", "Egypt", "Estonia", "Ethiopia",
  "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Honduras",
  "Hungary", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", "Lithuania",
  "Luxembourg", "Malaysia", "Mexico", "Moldova", "Monaco", "Morocco", "Netherlands",
  "New Zealand", "Nigeria", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru",
  "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia",
  "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain",
  "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Thailand", "Tunisia", "Turkey",
  "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
  "Uzbekistan", "Venezuela", "Vietnam", "Zimbabwe",
];

export default function ProfileForm({ member }: ProfileFormProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(member.profile_photo_url);
  const address = member.address as Address | null;

  const [phoneE164, setPhoneE164] = useState<string | null>(member.phone);
  const [marketingConsent, setMarketingConsent] = useState(member.marketing_consent);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const supabase = createClient();
    const ext = file.name.split(".").pop();
    const path = `${member.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-photos")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setError("Photo upload failed. Please try again.");
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("profile-photos").getPublicUrl(path);
    setPhotoUrl(data.publicUrl);

    // Save URL immediately
    await fetch("/api/member/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_photo_url: data.publicUrl }),
    });

    setUploading(false);
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/member/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: form.get("first_name"),
        last_name: form.get("last_name"),
        phone: phoneE164,
        company_name: form.get("company_name") || null,
        company_role: form.get("company_role") || null,
        address: {
          street: form.get("street") || null,
          city: form.get("city") || null,
          postal_code: form.get("postal_code") || null,
          country: form.get("country") || null,
        },
        marketing_consent: marketingConsent,
      }),
    });

    setSaving(false);
    if (res.ok) {
      setSuccess(true);
      router.refresh();
    } else {
      setError("Failed to update profile. Please try again.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Photo */}
      <div className="bg-white rounded-xl border border-border p-6 flex items-center gap-6">
        <div className="relative">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt="Profile photo"
              className="w-20 h-20 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-cream border border-border flex items-center justify-center text-2xl font-heading text-marine">
              {member.first_name[0]}{member.last_name[0]}
            </div>
          )}
        </div>
        <div>
          <p className="text-sm font-body font-medium text-marine mb-1">Profile Photo</p>
          <p className="text-xs text-muted-foreground font-body mb-3">JPG, PNG or WebP. Max 5MB.</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Change Photo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoChange}
          />
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-border p-6 space-y-6">
        {/* Personal */}
        <div>
          <h2 className="font-body font-semibold text-marine mb-4">Personal Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="first_name" className="block text-sm font-body font-medium text-marine mb-1.5">First Name</label>
              <input id="first_name" name="first_name" type="text" defaultValue={member.first_name} required
                className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
            </div>
            <div>
              <label htmlFor="last_name" className="block text-sm font-body font-medium text-marine mb-1.5">Last Name</label>
              <input id="last_name" name="last_name" type="text" defaultValue={member.last_name} required
                className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-body font-medium text-marine mb-1.5">Email</label>
            <input type="email" value={member.email} disabled
              className="w-full px-4 py-3 rounded-lg border border-border bg-cream text-muted-foreground font-body text-sm cursor-not-allowed" />
            <p className="text-xs text-muted-foreground font-body mt-1">Contact the club to change your email address.</p>
          </div>
          <div className="mt-4">
            <label htmlFor="phone" className="block text-sm font-body font-medium text-marine mb-1.5">Phone</label>
            <PhoneInput id="phone" defaultValue={member.phone} onChange={setPhoneE164} />
          </div>
        </div>

        {/* Address */}
        <div className="pt-4 border-t border-border">
          <h2 className="font-body font-semibold text-marine mb-4">Address</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="street" className="block text-sm font-body font-medium text-marine mb-1.5">Street</label>
              <input id="street" name="street" type="text" defaultValue={address?.street || ""}
                className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="city" className="block text-sm font-body font-medium text-marine mb-1.5">City</label>
                <input id="city" name="city" type="text" defaultValue={address?.city || ""}
                  className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
              </div>
              <div>
                <label htmlFor="postal_code" className="block text-sm font-body font-medium text-marine mb-1.5">Postal Code</label>
                <input id="postal_code" name="postal_code" type="text" defaultValue={address?.postal_code || ""}
                  className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
              </div>
            </div>
            <div>
              <label htmlFor="country" className="block text-sm font-body font-medium text-marine mb-1.5">Country</label>
              <select id="country" name="country" defaultValue={address?.country || ""}
                className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50">
                <option value="">Select country</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Company */}
        <div className="pt-4 border-t border-border">
          <h2 className="font-body font-semibold text-marine mb-4">Professional</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company_name" className="block text-sm font-body font-medium text-marine mb-1.5">Company</label>
              <input id="company_name" name="company_name" type="text" defaultValue={member.company_name || ""}
                className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
            </div>
            <div>
              <label htmlFor="company_role" className="block text-sm font-body font-medium text-marine mb-1.5">Role</label>
              <input id="company_role" name="company_role" type="text" defaultValue={member.company_role || ""}
                className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50" />
            </div>
          </div>
        </div>

        {/* Communications */}
        <div className="pt-4 border-t border-border">
          <h2 className="font-body font-semibold text-marine mb-4">Communications</h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border text-marine focus:ring-2 focus:ring-sky/50"
            />
            <span className="text-sm font-body text-marine">
              <span className="block font-medium">Member communications</span>
              <span className="block text-muted-foreground mt-0.5">
                Receive occasional emails from the club — events, partner offers, and member news. Renewal and account emails are sent regardless of this setting.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="text-sm text-destructive font-body">{error}</p>}
        {success && <p className="text-sm text-green-700 font-body">Profile updated successfully.</p>}

        <button type="submit" disabled={saving}
          className="px-6 py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50">
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
