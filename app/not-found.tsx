import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-white">
      <div className="text-center max-w-md">
        <h1 className="font-heading text-4xl font-bold text-marine mb-4">
          Page Not Found
        </h1>
        <p className="text-muted-foreground font-body mb-8">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/login"
          className="px-6 py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors inline-block"
        >
          Go to Login
        </Link>
      </div>
    </div>
  );
}
