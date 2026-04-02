import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export default async function RegulationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from("members")
    .select("status")
    .eq("email", user.email)
    .single();

  if (!member || member.status !== "active") redirect("/dashboard");

  return (
    <div className="max-w-3xl mx-auto py-4">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-1">
            Club Rules
          </p>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine">
            Internal Regulations
          </h1>
          <p className="font-body text-sm text-muted-foreground mt-1">
            Geneva Polo Club — GPC Suisse &amp; GPC de Haute Savoie
          </p>
        </div>
        <Link
          href="/Geneva Polo Club Internal Regulations.pdf"
          target="_blank"
          className="shrink-0 ml-4 text-xs font-body text-sky-dark underline underline-offset-4 hover:text-marine transition-colors"
        >
          Download PDF
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-border p-6 sm:p-10 font-body text-marine">
        <p className="text-sm leading-relaxed text-marine/80 mb-8">
          The Geneva Polo Club (GPC Suisse and GPC de Haute Savoie) as well as the EARL SCCF (working in collaboration with the Geneva Polo Club) is a space for sport, camaraderie, and respect for members, guests, and staff. These regulations ensure that everyone can enjoy the club in a welcoming, safe, and environmentally responsible manner. By entering the club, all members and visitors agree to abide by the following rules:
        </p>

        <div className="space-y-8">
          {[
            {
              title: "1. Respect for Members and Guests",
              items: [
                "All members and guests must treat each other, as well as club staff, with courtesy and respect, regardless of background, ethnicity, nationality, or social status.",
                "Discriminatory behavior of any kind (based on race, gender, religion, etc.) will not be tolerated and may result in disciplinary action, including suspension or termination of membership.",
              ],
            },
            {
              title: "2. Noise and Behavior",
              items: [
                "Members and visitors are expected to maintain a peaceful environment. Loud, disruptive behavior is prohibited, particularly during polo matches, events, and gatherings.",
                "Please refrain from playing loud music or creating excessive noise that could disturb other members and guests.",
                "Please refrain from any dangerous activity.",
              ],
            },
            {
              title: "3. Cleanliness and Tidiness",
              items: [
                "Members and guests are responsible for keeping the club premises clean and tidy.",
                "All personal items and waste must be disposed of in the appropriate bins. Please avoid leaving any mess in common areas, including the fields, terraces, lounges, and locker rooms.",
              ],
            },
            {
              title: "4. Pets",
              items: [
                "For the safety and comfort of all members, dogs and other pets are not permitted on the club grounds, including during events and matches, unless they are service animals with proper documentation.",
                "Authorized pets must be on a leash.",
              ],
            },
            {
              title: "5. Dress Code",
              items: [
                "While there is no formal dress code at the Geneva Polo Club, members and guests are expected to dress respectfully and appropriately.",
                "Casual and smart attire is welcome, but please avoid clothing that may be deemed offensive or inappropriate for a club environment.",
              ],
            },
            {
              title: "6. Use of Club Facilities",
              items: [
                "The use of club facilities, including polo fields, lounges, bars, and parking areas, is reserved for members and their invited guests. Non-members must have prior approval from the club management to access the facilities.",
                "There is no subleasing of any land, facilities, or equipment of the club under any circumstances.",
                "The club grounds and all associated facilities are private. Membership and guest privileges only provide temporary access for use and do not constitute any form of public access or activity.",
              ],
            },
            {
              title: "7. Payments",
              items: [
                "All membership fees, event charges, and any other payments owed to the club must be made on time, as per the payment schedules provided by the club management.",
                "Late payments may result in sanctions, including suspension of membership privileges or access to club facilities, until outstanding dues are paid in full.",
              ],
            },
            {
              title: "8. Agricultural Activities",
              items: [
                "The EARL SCCF operates as a working farm and collaborates with the Geneva Polo Club who promotes the activity of polo as well as the community around polo and agri tourism. The EARL SCCF and GPC are focused on and support regenerative farming practices. Members and visitors should be aware of the ongoing agricultural activities and respect the farm's operations at all times.",
                "Machinery such as tractors and other farming equipment may be in operation. All members and guests are expected to exercise caution and avoid restricted areas where farming activities are taking place.",
                "The majority of the club's land and facilities are dedicated to agricultural use (pastures, grazing, etc.). Eco-touristic activities that align with local legislation may occasionally take place, but these will always be in harmony with the club's primary agricultural focus.",
              ],
            },
            {
              title: "9. Environmental Responsibility",
              items: [
                "The Geneva Polo Club is committed to environmental sustainability. As a regenerative farm, we prioritise practices that restore and enhance the ecosystem.",
                "Members and guests are expected to respect the environment during their visits to the club. Littering, wasting resources, or engaging in behavior that could harm the natural surroundings is strictly prohibited.",
              ],
            },
            {
              title: "10. Children",
              items: [
                "Children are welcome at the club but must be supervised by an adult at all times. They should not disrupt polo matches or disturb other members.",
              ],
            },
            {
              title: "11. Compliance with Polo Rules",
              items: [
                "Members and visitors are expected to respect the rules of polo as well as the regulations set by the Geneva Polo Club for safety and fair play.",
                "Any member or guest participating in a polo match or training must follow the guidance of the coaches, referees, and staff at all times.",
              ],
            },
            {
              title: "12. Alcohol and Substance Use",
              items: [
                "Alcohol must be consumed in moderation at all times. The club encourages responsible drinking to ensure a safe and pleasant environment for everyone.",
                "The consumption of alcohol by minors is strictly prohibited. All members and guests are required to adhere to local laws and regulations regarding the consumption of alcohol and the use of drugs or other illegal substances.",
                "The possession or use of illegal substances on club grounds is strictly prohibited and will result in immediate expulsion and further legal action if necessary.",
              ],
            },
            {
              title: "13. Safety",
              items: [
                "Safety is a top priority at the Geneva Polo Club. Please adhere to all safety protocols and respect signage indicating restricted areas.",
                "Guests and members are responsible for their own safety and are advised to be cautious, especially around horses, polo matches, and agricultural machinery.",
                "Given that the club is a working farm, members and guests should be mindful of risks related to farming equipment, tractors, and other machinery that may be in use. Please respect all safety barriers and signage around these areas.",
              ],
            },
            {
              title: "14. Cultural and Social Inclusion",
              items: [
                "The Geneva Polo Club prides itself on being a multicultural and inclusive space. Members and guests from all ethnic, social, and cultural backgrounds are welcome.",
                "We expect all members and visitors to contribute to an environment that celebrates diversity and inclusion.",
              ],
            },
            {
              title: "15. Waiver of Responsibility",
              items: [
                "All members and visitors acknowledge that there are inherent risks associated with polo and other equestrian activities, including but not limited to injuries caused by horses, flying balls, and physical activity on the field.",
                "Additionally, the club operates as a working farm, and members and visitors assume responsibility for their safety in proximity to agricultural machinery and equipment.",
                "By entering the club premises and participating in any activities, members and guests assume full responsibility for their own safety and well-being. This includes any risks related to polo matches, training sessions, or simply being near horses or machinery.",
                "The Geneva Polo Club, EARL SCCF as well as any other associated entities, its management, staff, and affiliates will not be held liable for any injuries, accidents, or damages that may occur on the premises. Members and visitors enter and use the facilities at their own risk, and it is their responsibility to ensure their own safety, including wearing appropriate protective gear when necessary.",
                "All members and visitors must have their own insurance coverage that provides for any accidents or incidents that may occur on club grounds.",
              ],
            },
            {
              title: "16. Media Rights",
              items: [
                "The Geneva Polo Club holds exclusive rights to all photographs, videos, or other media captured on its premises during events, matches, or activities. The club may use these images and videos for promotional, archival, or marketing purposes.",
                "If a member or visitor does not wish to appear in any photos or media, they must notify the club in advance. The club will make every reasonable effort to exclude them from such media, though complete exclusion cannot be guaranteed.",
              ],
            },
            {
              title: "17. Disciplinary Actions and Conflict Mediation",
              items: [
                "The Geneva Polo Club retains sole and absolute authority to mediate and resolve any conflicts or disputes that may arise between members, visitors, or staff.",
                "The club management reserves full discretion to determine and apply any sanctions as it sees fit, including warnings, suspension of privileges, or termination of membership, based on the circumstances of each case.",
                "Decisions made by the club management regarding conflict resolution and disciplinary actions are final and binding on all parties involved.",
              ],
            },
            {
              title: "18. Private Grounds",
              items: [
                "The Geneva Polo Club and the grounds of EARL SCCF is private property, and members are granted temporary use of the facilities as part of their membership or visitor privileges.",
                "The club does not operate any public activities, and access to the grounds is restricted to members, their guests, and approved visitors.",
                "Any unauthorized use of club facilities, including subleasing or third-party use, is strictly prohibited.",
              ],
            },
          ].map((section) => (
            <section key={section.title}>
              <h2 className="font-heading text-base font-bold mb-3">{section.title}</h2>
              <ul className="space-y-2 text-sm leading-relaxed text-marine/80 list-disc list-inside">
                {section.items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </section>
          ))}

          <section>
            <h2 className="font-heading text-base font-bold mb-3">Conclusion</h2>
            <p className="text-sm leading-relaxed text-marine/80 mb-3">
              These regulations ensure that the Geneva Polo Club remains a harmonious, safe, and environmentally responsible place for all. By respecting the club&rsquo;s rules, members and guests contribute to a positive and enjoyable experience for everyone.
            </p>
            <p className="text-sm leading-relaxed text-marine/80">
              Thank you for your cooperation, and we look forward to seeing you at the club!
            </p>
          </section>
        </div>

        <div className="pt-6 mt-6 border-t border-border text-xs text-muted-foreground">
          Geneva Polo Club (GPC) — John Coast Sullenger, President
        </div>
      </div>
    </div>
  );
}
