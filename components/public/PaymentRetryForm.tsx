"use client";

import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe-client";

interface PaymentRetryFormProps {
  token: string;
  memberName: string;
  tierName: string;
  amount: number;
  memberId: string;
  isScaCompletion: boolean;
  existingClientSecret: string | null;
}

function formatPrice(eur: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
  }).format(eur);
}

// SCA completion form — resumes 3D Secure on existing PI, no new card entry needed
function ScaCompletionForm({
  clientSecret,
  amount,
}: {
  clientSecret: string;
  amount: number;
}) {
  const stripe = useStripe();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState(false);

  async function handleComplete() {
    if (!stripe) return;

    setProcessing(true);
    setError("");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const { error: confirmError } = await stripe.confirmPayment({
      clientSecret,
      confirmParams: {
        return_url: `${appUrl}/pay/retry/success`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Authentication failed. Please try again.");
      setProcessing(false);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center">
        <h2 className="font-heading text-2xl font-bold text-marine mb-2">
          Authentication Complete
        </h2>
        <p className="text-muted-foreground font-body">
          Your membership is being activated. You will receive a confirmation
          email shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
          {error}
        </div>
      )}
      <p className="text-sm text-marine/70 font-body">
        Your bank requires additional authentication to complete this payment of{" "}
        <strong>{formatPrice(amount)}</strong>. Click below to proceed.
      </p>
      <button
        type="button"
        onClick={handleComplete}
        disabled={!stripe || processing}
        className="w-full py-3.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? "Authenticating..." : "Complete Authentication"}
      </button>
    </div>
  );
}

// New card entry form — creates a fresh PI for retry
function RetryForm({
  token,
  amount,
  memberId,
}: {
  token: string;
  amount: number;
  memberId: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState(false);

  async function handlePayment() {
    if (!stripe || !elements) return;

    setProcessing(true);
    setError("");

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || "Please check your card details.");
      setProcessing(false);
      return;
    }

    const res = await fetch("/api/stripe/retry-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, member_id: memberId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to initialize payment. Please try again.");
      setProcessing(false);
      return;
    }

    const { clientSecret } = await res.json();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${appUrl}/pay/retry/success`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Payment failed. Please try again.");
      setProcessing(false);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center">
        <h2 className="font-heading text-2xl font-bold text-marine mb-2">
          Payment Successful
        </h2>
        <p className="text-muted-foreground font-body">
          Your membership is being activated. You will receive a confirmation
          email shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
          {error}
        </div>
      )}
      <PaymentElement />
      <button
        type="button"
        onClick={handlePayment}
        disabled={!stripe || processing}
        className="w-full py-3.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? "Processing..." : `Pay ${formatPrice(amount)}`}
      </button>
    </div>
  );
}

export default function PaymentRetryForm({
  token,
  memberName,
  tierName,
  amount,
  memberId,
  isScaCompletion,
  existingClientSecret,
}: PaymentRetryFormProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 rounded-lg border border-border">
        <div>
          <p className="font-body font-medium text-marine">{memberName}</p>
          <p className="text-sm text-muted-foreground font-body">{tierName}</p>
        </div>
        <span className="font-body font-semibold text-marine">
          {formatPrice(amount)}
        </span>
      </div>

      {isScaCompletion && existingClientSecret ? (
        // SCA completion — resume 3D Secure on existing PI (no Payment Element needed)
        <ScaCompletionForm
          clientSecret={existingClientSecret}
          amount={amount}
        />
      ) : (
        // New card entry — fresh PI via retry-payment API
        <Elements
          stripe={stripePromise}
          options={{
            mode: "payment",
            amount: Math.round(amount * 100),
            currency: "chf",
            paymentMethodTypes: ["card"],
            appearance: {
              theme: "flat",
              variables: {
                colorPrimary: "#052938",
              },
            },
          }}
        >
          <RetryForm token={token} amount={amount} memberId={memberId} />
        </Elements>
      )}

      <p className="text-xs text-center text-muted-foreground font-body">
        Your membership will be activated immediately upon successful payment.
      </p>
    </div>
  );
}
