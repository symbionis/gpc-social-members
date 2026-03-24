"use client";

import { useState } from "react";

interface Originator {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  invite_code: string | null;
}

interface Referral {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  originator_id: string;
}

interface OriginatorListProps {
  originators: Originator[];
  referrals: Referral[];
  appUrl: string;
}

export default function OriginatorList({
  originators,
  referrals,
  appUrl,
}: OriginatorListProps) {
  const [copied, setCopied] = useState<string | null>(null);

  function copyLink(inviteCode: string) {
    navigator.clipboard.writeText(`${appUrl}/apply/${inviteCode}`);
    setCopied(inviteCode);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6">
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

      {originators.length === 0 && (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground font-body">
            No originators configured yet.
          </p>
        </div>
      )}
    </div>
  );
}
