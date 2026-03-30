import Link from "next/link";

export default function ApplicationSuccessPage() {
  return (
    <>
    <div className="h-20 bg-marine" />
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-sky/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-sky-dark"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="font-heading text-3xl font-bold text-marine mb-4">
          Application Received
        </h1>
        <p className="text-muted-foreground font-body mb-2">
          Thank you for your interest in the Geneva Polo Club Social Member
          Club.
        </p>
        <p className="text-muted-foreground font-body mb-8">
          Our membership committee will review your application and you will
          receive an email with the outcome shortly.
        </p>
        <Link
          href="/login"
          className="text-sm font-body text-sky-dark hover:text-marine underline"
        >
          Already a member? Sign in
        </Link>
      </div>
    </div>
    </>
  );
}
