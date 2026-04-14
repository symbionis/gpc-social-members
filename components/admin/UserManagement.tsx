"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AdminUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  is_originator: boolean;
  is_approval_committee: boolean;
  invite_code: string | null;
}

interface UserManagementProps {
  users: AdminUser[];
}

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "team_admin", label: "Team Admin" },
  { value: "originator", label: "Originator" },
];

export default function UserManagement({ users }: UserManagementProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: form.get("first_name"),
        last_name: form.get("last_name"),
        email: form.get("email"),
        role: form.get("role"),
        is_approval_committee: form.get("is_approval_committee") === "on",
      }),
    });

    if (res.ok) {
      setShowForm(false);
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to create user");
    }
    setSaving(false);
  }

  async function handleRoleChange(id: string, role: string) {
    setUpdatingId(id);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    router.refresh();
    setUpdatingId(null);
  }

  async function toggleCommittee(id: string, current: boolean) {
    setUpdatingId(id);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_approval_committee: !current }),
    });
    router.refresh();
    setUpdatingId(null);
  }

  function roleBadgeColor(role: string) {
    switch (role) {
      case "super_admin":
        return "bg-marine text-white";
      case "team_admin":
        return "bg-sky/20 text-sky-dark";
      case "originator":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-gray-100 text-gray-600";
    }
  }

  return (
    <div className="space-y-6">
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-marine text-white text-sm font-body rounded-md hover:bg-marine-light transition-colors"
        >
          Add User
        </button>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h3 className="font-body font-semibold text-marine text-lg mb-4">
            New Admin User
          </h3>
          {error && (
            <p className="text-sm text-destructive font-body mb-4">{error}</p>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-body text-marine mb-1">
                  First Name
                </label>
                <input
                  name="first_name"
                  required
                  className="w-full px-3 py-2 border border-border rounded-md font-body text-sm focus:ring-2 focus:ring-sky/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-body text-marine mb-1">
                  Last Name
                </label>
                <input
                  name="last_name"
                  required
                  className="w-full px-3 py-2 border border-border rounded-md font-body text-sm focus:ring-2 focus:ring-sky/50 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-body text-marine mb-1">
                Email
              </label>
              <input
                name="email"
                type="email"
                required
                className="w-full px-3 py-2 border border-border rounded-md font-body text-sm focus:ring-2 focus:ring-sky/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-body text-marine mb-1">
                Role
              </label>
              <select
                name="role"
                required
                className="w-full px-3 py-2 border border-border rounded-md font-body text-sm focus:ring-2 focus:ring-sky/50 focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="is_approval_committee"
                className="w-4 h-4 rounded border-border text-marine focus:ring-sky"
              />
              <span className="text-sm font-body text-marine">
                Approval Committee Member
              </span>
            </label>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-marine text-white text-sm font-body rounded-md hover:bg-marine-light transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Create User"}
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

      {/* User table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-cream/50">
              <th className="text-left px-5 py-3 text-sm font-body font-medium text-marine">
                Name
              </th>
              <th className="text-left px-5 py-3 text-sm font-body font-medium text-marine">
                Email
              </th>
              <th className="text-left px-5 py-3 text-sm font-body font-medium text-marine">
                Role
              </th>
              <th className="text-left px-5 py-3 text-sm font-body font-medium text-marine">
                Permissions
              </th>
              <th className="text-left px-5 py-3 text-sm font-body font-medium text-marine">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-cream/30 transition-colors">
                <td className="px-5 py-3 font-body text-sm text-marine">
                  {u.first_name} {u.last_name}
                </td>
                <td className="px-5 py-3 font-body text-sm text-muted-foreground">
                  {u.email}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-body font-medium ${roleBadgeColor(u.role)}`}
                  >
                    {u.role.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {u.is_approval_committee && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-body">
                        Committee
                      </span>
                    )}
                    {u.is_originator && (
                      <span className="px-2 py-0.5 bg-sky/10 text-sky-dark rounded-full text-xs font-body">
                        Originator
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={updatingId === u.id}
                      className="px-2 py-1 border border-border rounded text-xs font-body focus:ring-2 focus:ring-sky/50 focus:outline-none disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => toggleCommittee(u.id, u.is_approval_committee)}
                      disabled={updatingId === u.id}
                      className={`px-2 py-1 border rounded text-xs font-body transition-colors disabled:opacity-50 ${
                        u.is_approval_committee
                          ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
                          : "border-border text-muted-foreground hover:bg-cream"
                      }`}
                    >
                      {u.is_approval_committee ? "On Committee" : "Add to Committee"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
