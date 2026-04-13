"use client";

import { useState, useEffect } from "react";
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
  const [stripeReady, setStripeReady] = useState(false);

  // Detect when Stripe has loaded and Payment Element is ready
  useEffect(() => {
    if (stripe && elements) {
      setStripeReady(true);
    }
  }, [stripe, elements]);

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
        disabled={!stripeReady || processing}
        className="w-full py-3.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? "Authorizing..." : "Submit Application"}
      </button>
    </div>
  );
}

export default function PaymentSection(props: PaymentSectionProps) {
  const [stripeFailed, setStripeFailed] = useState(false);

  // Detect if Stripe.js failed to load (key is undefined/invalid)
  useEffect(() => {
    stripePromise.then((stripe) => {
      if (!stripe) {
        setStripeFailed(true);
      }
    }).catch(() => {
      setStripeFailed(true);
    });
  }, []);

  if (stripeFailed) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
          <p className="font-medium mb-1">Payment system unavailable</p>
          <p>
            We&apos;re unable to load the payment form. Your application has been
            saved. Please try again by reloading the page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full py-3.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors"
        >
          Reload Page
        </button>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: "payment",
        amount: Math.round(props.amount * 100),
        currency: "chf",
        captureMethod: "manual",
        setupFutureUsage: "off_session",
        paymentMethodTypes: ["card"],
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
