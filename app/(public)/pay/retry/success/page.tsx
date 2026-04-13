export default function PaymentRetrySuccessPage() {
  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="font-heading text-3xl font-bold text-marine mb-4">
            Payment Successful
          </h1>
          <p className="text-muted-foreground font-body mb-6">
            Your membership is being activated. You will receive a confirmation
            email with your digital membership card shortly.
          </p>
          <a
            href="/login"
            className="inline-block px-6 py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    </>
  );
}
