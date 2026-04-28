"use client";

import { useState } from "react";

interface Props {
  images: string[];
  alt: string;
  /** aspect ratio for the displayed image, default 16/9 */
  aspectClass?: string;
}

export default function EventGallery({
  images,
  alt,
  aspectClass = "aspect-[16/9]",
}: Props) {
  const [index, setIndex] = useState(0);

  if (!images || images.length === 0) return null;

  const total = images.length;
  const safe = ((index % total) + total) % total;
  const goPrev = () => setIndex((i) => (i - 1 + total) % total);
  const goNext = () => setIndex((i) => (i + 1) % total);

  return (
    <div className="relative">
      <div
        className={`relative w-full ${aspectClass} rounded-lg overflow-hidden border border-border bg-cream`}
      >
        {images.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${url}-${i}`}
            src={url}
            alt={alt}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
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
          </>
        )}
      </div>

      {total > 1 && (
        <div className="flex justify-center gap-2 mt-3">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to image ${i + 1}`}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === safe ? "bg-marine" : "bg-marine/25 hover:bg-marine/50"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
