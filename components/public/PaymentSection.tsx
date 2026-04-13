"use client";

import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe-client";

interface PaymentSectionProps {
  amount: number;
  memberId: string;
  onSuccess: () => void;
  onError: (message: string) => void;
}

function PaymentForm({
  amount,
  memberId,
  onSuccess,
  onError,
}: PaymentSectionProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const formatPrice = (eur: number) =>
    new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency: "CHF",
      minimumFractionDigits: 0,
    }).format(eur);

  async function handlePayment() {
    if (!stripe || !elements) return;

    setProcessing(true);
    onError("");

    // Validate the Payment Element fields
    const { error: submitError } = await elements.submit();
    if (submitError) {
      onError(submitError.message || "Please check your card details.");
      setProcessing(false);
      return;
    }

    // Create PaymentIntent server-side
    const res = await fetch("/api/stripe/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data.error || "Failed to initialize payment. Please try again.");
      setProcessing(false);
      return;
    }

    const { clientSecret } = await res.json();

    // Confirm payment (triggers 3D Secure if required)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${appUrl}/apply/success`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      onError(
        confirmError.message || "Payment authorization failed. Please try again."
      );
      setProcessing(false);
      return;
    }

    // Authorization succeeded (no redirect needed)
    onSuccess();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-marine/70 font-body">
        Your card will not be charged now. A hold of{" "}
        <strong>{formatPrice(amount)}</strong> will be placed on your card and
        only captured if your application is approved.
      </p>
      <PaymentElement />
      <button
        type="button"
        onClick={handlePayment}
        disabled={!stripe || processing}
        className="w-full py-3.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? "Authorizing..." : "Submit Application"}
      </button>
    </div>
  );
}

export default function PaymentSection(props: PaymentSectionProps) {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: "payment",
        amount: Math.round(props.amount * 100),
        currency: "chf",
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#052938",
            fontFamily: "inherit",
          },
        },
      }}
    >
      <PaymentForm {...props} />
    </Elements>
  );
}
