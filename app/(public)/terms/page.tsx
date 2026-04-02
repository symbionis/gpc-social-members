import Link from "next/link";

export default function TermsPage() {
  return (
    <>
    <div className="bg-marine h-20 w-full" />
    <div className="bg-cream min-h-screen px-6 py-16"><div className="max-w-3xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-1">
            Legal
          </p>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine">
            General Terms &amp; Conditions
          </h1>
          <p className="font-body text-sm text-muted-foreground mt-1">
            Sale of Social Memberships — Geneva Polo Club
          </p>
        </div>
        <Link
          href="/CGV Social_Membership.pdf"
          target="_blank"
          className="shrink-0 ml-4 text-xs font-body text-sky-dark underline underline-offset-4 hover:text-marine transition-colors"
        >
          Download PDF
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-border p-6 sm:p-10 space-y-8 font-body text-marine">

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 1 — Terminology</h2>
          <ul className="space-y-2 text-sm leading-relaxed text-marine/80 list-disc list-inside">
            <li><strong>GPC:</strong> The Geneva Polo Club (GPC Switzerland in collaboration with GPC Haute-Savoie) is a private club focused on promoting polo and organizing sporting events.</li>
            <li><strong>Social Membership:</strong> A membership that provides exclusive benefits to members for an annual fee.</li>
            <li><strong>Member:</strong> Individual or entity who has enrolled in a Social Membership as outlined in these General Conditions of Sale (GCS).</li>
          </ul>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 2 — Social Membership Categories</h2>
          <p className="text-sm leading-relaxed text-marine/80 mb-4">The Social Memberships provided by the Polo Club are categorized into several groups:</p>
          <div className="space-y-4 text-sm leading-relaxed text-marine/80">
            {[
              {
                title: "Annual Classic Social Membership: €500",
                items: ["Digital membership card", "General access to events and tournaments", "Access to the WhatsApp community", "Access to the VIP lodge", "GPC Welcome kit", "5 guest invitations per year"],
              },
              {
                title: "Exclusive Social Membership: €1,000 per year",
                items: ["Digital membership card", "Complete access to events and tournaments", "Exclusive promotions and presents from GPC affiliates", "Access to the WhatsApp community", "Access to the VIP lodge", "GPC Welcome kit", "10 guest invitations per year"],
              },
              {
                title: "Corporate Small Membership: €3,000 annually (0–50 employees)",
                items: ["Digital membership card", "Company logo on the GPC website and official acknowledgments", "Company team photo featuring the GPC polo team", "Private polo match on the field side", "5 designated individuals with full access + 5 extra one-time invitations"],
              },
              {
                title: "Corporate Medium Membership: €6,000 annually (51–100 employees)",
                items: ["Digital membership card", "Corporate logo on the GPC website", "Company team photo featuring the GPC polo team", "Private polo match on the field side", "10 designated individuals with full access + 10 extra one-time invitations"],
              },
              {
                title: "Corporate Large Membership: €12,000 annually (101–200 employees)",
                items: ["Digital membership card", "Company logo on the GPC website and official acknowledgments", "Company team photo featuring the GPC polo team", "Private polo match on the field side", "20 designated individuals with full access + 20 extra one-time invitations"],
              },
            ].map((cat, i) => (
              <div key={i}>
                <p className="font-semibold text-marine">{i + 1}. {cat.title}</p>
                <ul className="mt-1.5 ml-4 list-disc list-inside space-y-0.5">
                  {cat.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 3 — Terms of Membership</h2>
          <p className="text-sm leading-relaxed text-marine/80">Social Membership is completed through the GPC website or by completing a specific form. Membership payment is made on a yearly basis and remains active for 12 months from the purchase date.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 4 — Membership Application Review</h2>
          <p className="text-sm leading-relaxed text-marine/80">The Polo Club meticulously evaluates each membership application, considering the candidate&rsquo;s values and dedication to the club and its pursuits. Admission is not automatic and is contingent upon a thorough assessment. The club retains the right to approve or decline applications without providing a rationale. Preference is given to individuals who uphold the values of respect, sportsmanship, and camaraderie promoted by the Polo Club. The club embraces an inclusive ethos, welcoming diversity in ethnicity, culture, gender, and more. Applications supported by a current member&rsquo;s recommendation or sponsorship are more likely to be accepted. Endorsement by a respected member typically signifies the candidate&rsquo;s caliber and eases their assimilation into the club. The evaluation process may involve conversations with the candidate or other members, as well as an examination of their potential contributions to the club&rsquo;s endeavors.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 5 — Social Members&rsquo; Access to the Polo Club</h2>
          <p className="text-sm leading-relaxed text-marine/80 mb-3">Social members have access to the Polo Club based on their selected category to attend various events such as tournaments, training sessions, and more (excluding private events). To gain entry, social members only need to carry their digital membership card and display it when necessary. A yearly event calendar is available for social members to view, allowing them to attend events without prior booking. Events necessitating reservations will be clearly indicated.</p>
          <p className="text-sm leading-relaxed text-marine/80">Invitations from all social member categories are freely usable throughout the year. Social members must inform the Polo Club about their invitation usage promptly by emailing <a href="mailto:sponsoring@genevapolo.com" className="underline underline-offset-2">sponsoring@genevapolo.com</a> with the guest&rsquo;s name, email address, and the invitation date. This notification should be sent at least 5 hours before the social member and their guest(s) arrive.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 6 — Invitations for Family and Coworkers</h2>
          <p className="text-sm leading-relaxed text-marine/80 mb-3">Members in various Social Membership categories enjoy a set number of complimentary invitations annually. These invitations can be extended to family members or associates for their attendance at Polo Club events and tournaments. Once validated, these invitations are specific to the member and cannot be transferred.</p>
          <ul className="space-y-1.5 text-sm leading-relaxed text-marine/80 list-disc list-inside">
            <li><strong>Classic Social Membership:</strong> 5 invitations per year.</li>
            <li><strong>Exclusive Social Membership:</strong> 10 invitations per year.</li>
            <li><strong>Corporate Small:</strong> 5 individuals with full annual access + 5 extra invitations.</li>
            <li><strong>Corporate Medium:</strong> 10 individuals with full yearly privileges + 10 extra invitations.</li>
            <li><strong>Corporate Large:</strong> 10 individuals with full yearly privileges + 10 extra invitations.</li>
          </ul>
          <p className="text-sm leading-relaxed text-marine/80 mt-3">Additional invitations for each category can be acquired with the Polo Club&rsquo;s approval for a fee of CHF 40 per invitation.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 7 — Member Perks</h2>
          <p className="text-sm leading-relaxed text-marine/80">Each Social Membership category grants specific benefits outlined in Article 2. The Polo Club retains the right to adjust these benefits based on availability and circumstances.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 8 — Payment Terms</h2>
          <p className="text-sm leading-relaxed text-marine/80">The membership fee must be paid in full upon registration using a credit card, bank transfer, or any other accepted payment method at the Polo Club. The cost of each Social Membership is specified in Swiss Francs, inclusive of all taxes.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 9 — Membership Duration</h2>
          <p className="text-sm leading-relaxed text-marine/80">Each Social Membership lasts for 12 months from the purchase date and will be automatically cancelled at the end of this term if not renewed by the member.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 10 — Termination and Reimbursement</h2>
          <p className="text-sm leading-relaxed text-marine/80">The member has the option to end their Social Membership at any point, with no refund available unless in cases of valid force majeure. The Polo Club retains the authority to end a member&rsquo;s membership due to rule violations or improper conduct at events.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 11 — Adherence to the Polo Club&rsquo;s Internal Regulations</h2>
          <p className="text-sm leading-relaxed text-marine/80">By enrolling as a Social Member, individuals and their guests are implicitly agreeing to adhere to the Polo Club&rsquo;s general rules and these sales terms and conditions. The Polo Club retains the authority to impose penalties, including potentially revoking Social Membership, for violations or failure to comply with the club&rsquo;s regulations.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 12 — Amendment of Terms and Conditions</h2>
          <p className="text-sm leading-relaxed text-marine/80">The Polo Club retains the authority to amend these General Conditions of Sale at any moment. Any changes will be communicated to the members and will take effect immediately.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 13 — Safeguarding of Personal Data and Image Rights</h2>
          <p className="text-sm leading-relaxed text-marine/80">Data gathered through Social Membership is handled in compliance with current personal data protection laws. Members have the privilege to access, correct, and erase their personal information. The Polo Club and its activities receive media coverage. Social Members grant permission for their image and media content to be utilised across various platforms. Should a member decline, notification must be given to the Polo Club, which will strive to honour the member&rsquo;s decision.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 14 — Involvement</h2>
          <p className="text-sm leading-relaxed text-marine/80">The Polo Club is dedicated to offering the advantages included in every Social Membership. Nevertheless, the Polo Club cannot be accountable for the failure to realise a benefit in cases of force majeure or circumstances beyond its control. It is worth noting that polo activities are subject to weather conditions. The Polo Club pledges to contribute 10% of social membership fees to the associations and foundations endorsed by the club.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 15 — Responsibility and Associated Risks</h2>
          <p className="text-sm leading-relaxed text-marine/80">Polo entails risks for both players and spectators, such as balls leaving the field and fast-moving horses. Members are duly informed of these risks and absolve the Polo Club of any liability.</p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-bold mb-3">Article 16 — Jurisdiction and Applicable Law</h2>
          <p className="text-sm leading-relaxed text-marine/80">The General Conditions of Sale are governed by Swiss or French law. Any dispute regarding their interpretation or enforcement will fall under the exclusive jurisdiction of the relevant courts.</p>
        </section>

        <div className="pt-4 border-t border-border text-xs text-muted-foreground">
          Geneva Polo Club (GPC) — John Coast Sullenger, President
        </div>
      </div>
    </div></div>
    </>
  );
}
