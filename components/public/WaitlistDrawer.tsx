"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import WaitlistForm from "./WaitlistForm";

interface Props {
  eventId: string;
  eventTitle: string;
  defaultName?: string;
  defaultEmail?: string;
}

/**
 * The fully-booked counterpart of EventRegistrationDrawer: the same button slot and
 * drawer chrome, but the form inside only asks for a name and contact details. No
 * ticket is chosen here — the invitee picks one on the offer landing when a seat
 * is released to them.
 */
export default function WaitlistDrawer({ eventId, eventTitle, defaultName, defaultEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Same body-scroll lock as EventRegistrationDrawer — iOS Safari otherwise scrolls
  // the page beneath the drawer and the form reads as broken.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

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
        aria-label={`Join the waitlist for ${eventTitle}`}
        className="fixed top-0 right-0 h-full h-[100dvh] w-full sm:w-[480px] max-w-full bg-white shadow-xl z-[110] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-xs font-body text-muted-foreground uppercase tracking-wide">
              Waitlist
            </p>
            <h2 className="font-heading text-lg font-bold text-marine">{eventTitle}</h2>
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
        <div className="flex-1 overflow-y-auto px-6 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p className="font-body text-sm text-muted-foreground mb-4">
            This event is fully booked. Leave your details and we&apos;ll email you if a
            ticket opens up — you&apos;ll choose your ticket then.
          </p>
          <WaitlistForm eventId={eventId} defaultName={defaultName} defaultEmail={defaultEmail} />
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
        Join waitlist
      </button>
      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
