"use client";

import { QRCodeSVG } from "qrcode.react";

interface MembershipCardProps {
  memberName: string;
  memberNumber: string;
  tierName: string;
  cardNumber: string;
  validFrom: string;
  validUntil: string;
  verifyUrl: string;
}

export default function MembershipCard({
  memberName,
  memberNumber,
  tierName,
  cardNumber,
  validFrom,
  validUntil,
  verifyUrl,
}: MembershipCardProps) {
  const year = new Date(validFrom).getFullYear();

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="bg-marine rounded-2xl p-8 text-white shadow-xl aspect-[3/4.5] flex flex-col justify-between">
        {/* Header */}
        <div className="text-center">
          <p className="font-accent text-xs uppercase tracking-[0.25em] text-sky mb-1">
            SOCIAL MEMBER CLUB
          </p>
          <h2 className="font-heading text-2xl font-bold leading-tight">
            Geneva Polo Club
          </h2>
          <p className="font-accent text-xs uppercase tracking-[0.15em] text-white/50 mt-2">
            SEASON {year}
          </p>
        </div>

        {/* Member Info */}
        <div className="text-center space-y-3">
          <div>
            <p className="font-heading text-xl font-bold">{memberName}</p>
            <span className="inline-block mt-2 px-3 py-1 bg-sky/20 text-sky rounded-full text-xs font-body font-medium">
              {tierName}
            </span>
          </div>
          <p className="font-accent text-sm uppercase tracking-[0.15em] text-white/70">
            {memberNumber}
          </p>
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center">
          <div className="bg-white rounded-xl p-3">
            <QRCodeSVG
              value={verifyUrl}
              size={120}
              fgColor="#052938"
              bgColor="#FFFFFF"
              level="M"
            />
          </div>
          <p className="mt-2 font-accent text-[10px] uppercase tracking-wider text-white/40">
            {cardNumber}
          </p>
        </div>

        {/* Validity */}
        <div className="flex justify-between text-xs font-body text-white/50">
          <div>
            <p className="text-white/30">VALID FROM</p>
            <p>
              {new Date(validFrom).toLocaleDateString("en-GB", {
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-white/30">VALID UNTIL</p>
            <p>
              {new Date(validUntil).toLocaleDateString("en-GB", {
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
