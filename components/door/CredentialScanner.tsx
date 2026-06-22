"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Camera QR scanner for the info desk (U7). Streams the rear camera into a hidden
// canvas and decodes frames with jsQR; on the first decode it calls onDecode and
// stops scanning (the parent re-arms by toggling `active`). Decoding is paused while
// inactive (e.g. a name/waiver prompt is up) so the camera light isn't on needlessly.
export default function CredentialScanner({
  active,
  onDecode,
  videoClassName = "h-64 w-full object-cover",
}: {
  active: boolean;
  onDecode: (value: string) => void;
  /** Sizing for the camera preview — the door scan modal passes a taller, full-bleed class. */
  videoClassName?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const stopStream = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        // Component unmounted (or scanning paused) while the permission prompt was
        // open — release the camera instead of leaking the track + indicator light.
        if (stopped || !videoRef.current) {
          stopStream();
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        const tick = () => {
          if (stopped) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx && canvas.width > 0) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, {
                inversionAttempts: "dontInvert",
              });
              if (code && code.data) {
                onDecodeRef.current(code.data);
                return; // stop after a hit; parent re-arms via `active`
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        stopStream();
        setDenied(true);
      }
    };

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopStream();
    };
  }, [active]);

  if (denied) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-center font-body text-sm text-amber-900">
        Camera unavailable. Allow camera access, or use the search below to find the guest
        by name.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-marine/20 bg-black">
      <video ref={videoRef} playsInline muted className={videoClassName} />
      <canvas ref={canvasRef} className="hidden" />
      {active && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-40 rounded-xl border-2 border-white/80" />
        </div>
      )}
    </div>
  );
}
