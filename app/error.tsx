"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-white">
      <div className="text-center max-w-md">
        <h1 className="font-heading text-4xl font-bold text-marine mb-4">
          Something Went Wrong
        </h1>
        <p className="text-muted-foreground font-body mb-8">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
