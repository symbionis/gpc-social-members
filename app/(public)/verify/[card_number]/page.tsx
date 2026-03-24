import { createAdminClient } from "@/lib/supabase/admin";

interface VerifyPageProps {
  params: Promise<{ card_number: string }>;
}

export default async function VerifyPage({ params }: VerifyPageProps) {
  const { card_number } = await params;
  const supabase = createAdminClient();

  const { data: cards } = await supabase
    .from("membership_cards")
    .select("id, card_number, member_id, valid_from, valid_until, is_active")
    .eq("card_number", card_number)
    .limit(1);

  const card = cards?.[0];

  if (!card) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="font-heading text-3xl font-bold text-marine mb-4">
            Card Not Found
          </h1>
          <p className="text-muted-foreground font-body">
            This membership card could not be verified.
          </p>
        </div>
      </div>
    );
  }

  // Get member details
  const { data: members } = await supabase
    .from("members")
    .select("first_name, last_name, tier_id, status, member_number")
    .eq("id", card.member_id)
    .limit(1);

  const member = members?.[0];

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("name")
    .eq("id", member?.tier_id || "")
    .limit(1);

  const tier = tiers?.[0];

  const isValid =
    card.is_active &&
    member?.status === "active" &&
    new Date(card.valid_until) >= new Date();

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${
            isValid ? "bg-green-100" : "bg-amber-100"
          }`}
        >
          <svg
            className={`w-8 h-8 ${isValid ? "text-green-700" : "text-amber-700"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {isValid ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            )}
          </svg>
        </div>

        <h1 className="font-heading text-3xl font-bold text-marine mb-2">
          {isValid ? "Valid Membership" : "Membership Issue"}
        </h1>

        {member && (
          <div className="mt-6 bg-white rounded-xl border border-border p-6 text-left">
            <p className="font-heading text-xl font-bold text-marine">
              {member.first_name} {member.last_name}
            </p>
            {tier && (
              <span className="inline-block mt-2 px-3 py-1 bg-sky/20 text-sky-dark rounded-full text-xs font-body font-medium">
                {tier.name}
              </span>
            )}
            <div className="mt-4 space-y-1 text-sm font-body">
              {member.member_number && (
                <p className="text-muted-foreground">
                  Member: <span className="text-marine">{member.member_number}</span>
                </p>
              )}
              <p className="text-muted-foreground">
                Card: <span className="text-marine">{card.card_number}</span>
              </p>
              <p className="text-muted-foreground">
                Valid until:{" "}
                <span className="text-marine">
                  {new Date(card.valid_until).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </p>
              <p className="text-muted-foreground">
                Status:{" "}
                <span
                  className={`font-medium ${isValid ? "text-green-700" : "text-amber-700"}`}
                >
                  {isValid ? "Active" : member.status === "active" ? "Expired" : member.status}
                </span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
