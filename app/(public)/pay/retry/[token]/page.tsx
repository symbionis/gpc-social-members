import { createAdminClient } from "@/lib/supabase/admin";
import PaymentRetryForm from "@/components/public/PaymentRetryForm";

interface RetryPageProps {
  params: Promise<{ token: string }>;
}

export default async function PaymentRetryPage({ params }: RetryPageProps) {
  const { token } = await params;
  const supabase = createAdminClient();

  // Validate token
  const { data: tokens } = await supabase
    .from("payment_retry_tokens")
    .select("id, member_id, payment_id, used, expires_at")
    .eq("token", token)
    .limit(1);

  const retryToken = tokens?.[0];

  if (!retryToken) {
    return (
      <>
        <div className="h-20 bg-marine" />
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <h1 className="font-heading text-3xl font-bold text-marine mb-4">
              Link Not Found
            </h1>
            <p className="text-muted-foreground font-body">
              This payment link is not valid. Please contact the club for
              assistance.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (retryToken.used) {
    return (
      <>
        <div className="h-20 bg-marine" />
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <h1 className="font-heading text-3xl font-bold text-marine mb-4">
              Payment Already Completed
            </h1>
            <p className="text-muted-foreground font-body">
              This payment has already been processed. If you believe this is an
              error, please contact the club.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (new Date(retryToken.expires_at) < new Date()) {
    return (
      <>
        <div className="h-20 bg-marine" />
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <h1 className="font-heading text-3xl font-bold text-marine mb-4">
              Link Expired
            </h1>
            <p className="text-muted-foreground font-body">
              This payment link has expired. Please contact the club for
              assistance.
            </p>
          </div>
        </div>
      </>
    );
  }

  // Fetch member and tier info
  const { data: members } = await supabase
    .from("members")
    .select("first_name, last_name, tier_id, stripe_customer_id")
    .eq("id", retryToken.member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return (
      <>
        <div className="h-20 bg-marine" />
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <h1 className="font-heading text-3xl font-bold text-marine mb-4">
              Member Not Found
            </h1>
            <p className="text-muted-foreground font-body">
              We could not locate your membership record. Please contact us.
            </p>
          </div>
        </div>
      </>
    );
  }

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("name, price_eur")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];

  // Check if this is a requires_action case (SCA completion)
  const { data: paymentData } = await supabase
    .from("payments")
    .select("payment_capture_status, stripe_payment_intent_id")
    .eq("id", retryToken.payment_id)
    .limit(1);

  const payment = paymentData?.[0];
  const isScaCompletion = payment?.payment_capture_status === "requires_action";

  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="min-h-[80vh] py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-10">
            <p className="text-sm font-accent uppercase tracking-widest text-sky-dark mb-2">
              {isScaCompletion ? "COMPLETE AUTHENTICATION" : "COMPLETE PAYMENT"}
            </p>
            <h1 className="font-heading text-4xl font-bold text-marine mb-3">
              {isScaCompletion
                ? `Welcome, ${member.first_name}`
                : `Update your payment, ${member.first_name}`}
            </h1>
            <p className="text-muted-foreground font-body max-w-lg mx-auto">
              {isScaCompletion
                ? "Your application has been approved. Please complete the payment authentication to activate your membership."
                : "Your application has been approved but the previous payment attempt failed. Please enter new card details to activate your membership."}
            </p>
          </div>

          <PaymentRetryForm
            token={token}
            memberName={`${member.first_name} ${member.last_name}`}
            tierName={tier?.name || "Member"}
            amount={tier?.price_eur || 0}
            memberId={retryToken.member_id}
            isScaCompletion={isScaCompletion}
            existingClientSecret={null}
          />
        </div>
      </div>
    </>
  );
}
