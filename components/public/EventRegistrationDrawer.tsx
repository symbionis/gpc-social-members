"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import EventRegistrationForm from "./EventRegistrationForm";

interface Props {
  eventId: string;
  eventTitle: string;
  priceMember: number;
  priceNonMember: number;
  defaultName?: string;
  defaultEmail?: string;
  /** Hide the non-member rate on the form (used on the member-facing page). */
  memberOnly?: boolean;
  buttonLabel: string;
}

export default function EventRegistrationDrawer({
  eventId,
  eventTitle,
  priceMember,
  priceNonMember,
  defaultName,
  defaultEmail,
  memberOnly = false,
  buttonLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const drawer = open ? (
    <>
      <div
        className="fixed inset-0 bg-marine/40 z-[100]"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Register for ${eventTitle}`}
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] max-w-full bg-white shadow-xl z-[110] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-xs font-body text-muted-foreground uppercase tracking-wide">
              Register
            </p>
            <h2 className="font-heading text-lg font-bold text-marine">
              {eventTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="w-9 h-9 rounded-full hover:bg-cream flex items-center justify-center text-muted-foreground hover:text-marine shrink-0 cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <EventRegistrationForm
            eventId={eventId}
            priceMember={priceMember}
            priceNonMember={priceNonMember}
            defaultName={defaultName}
            defaultEmail={defaultEmail}
            memberOnly={memberOnly}
            showMemberRate={false}
          />
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-block w-full text-center px-4 py-3 rounded-lg bg-marine text-white font-body font-medium text-sm hover:bg-marine-light transition-colors cursor-pointer"
      >
        {buttonLabel}
      </button>
      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
