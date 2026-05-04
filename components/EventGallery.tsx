"use client";

import { useState, useEffect } from "react";

interface Props {
  images: string[];
  alt: string;
  /** aspect ratio for the displayed image, default 16/9 */
  aspectClass?: string;
  /** When true, drop the rounded border + dot margin so the gallery fits inside an already-styled card. */
  bare?: boolean;
  /** Auto-advance interval in ms; 0 disables. Default 3000. */
  autoAdvanceMs?: number;
  /** "cover" crops to fill, "contain" letterboxes so the whole image is visible. Default "cover". */
  fit?: "cover" | "contain";
}

export default function EventGallery({
  images,
  alt,
  aspectClass = "aspect-[16/9]",
  bare = false,
  autoAdvanceMs = 3000,
  fit = "cover",
}: Props) {
  const [index, setIndex] = useState(0);

  const total = images?.length ?? 0;

  useEffect(() => {
    if (total <= 1 || autoAdvanceMs <= 0) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % total),
      autoAdvanceMs
    );
    return () => window.clearInterval(timer);
  }, [total, autoAdvanceMs]);

  if (!images || images.length === 0) return null;

  const safe = ((index % total) + total) % total;
  const goPrev = () => setIndex((i) => (i - 1 + total) % total);
  const goNext = () => setIndex((i) => (i + 1) % total);

  const frameClass = bare
    ? `relative w-full ${aspectClass} overflow-hidden bg-marine`
    : `relative w-full ${aspectClass} rounded-lg overflow-hidden border border-border bg-cream`;

  return (
    <div className="relative">
      <div className={frameClass}>
        {images.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${url}-${i}`}
            src={url}
            alt={alt}
            className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"} transition-opacity duration-500 ${
              i === safe ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous image"
              className="absolute top-1/2 left-3 -translate-y-1/2 w-10 h-10 rounded-full bg-white/85 hover:bg-white shadow flex items-center justify-center text-marine"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next image"
              className="absolute top-1/2 right-3 -translate-y-1/2 w-10 h-10 rounded-full bg-white/85 hover:bg-white shadow flex items-center justify-center text-marine"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>

            {/* Dots overlaid on the image bottom so they don't push layout below */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Go to image ${i + 1}`}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === safe
                      ? "bg-white"
                      : "bg-white/50 hover:bg-white/80"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
