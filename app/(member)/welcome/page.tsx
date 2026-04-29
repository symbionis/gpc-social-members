import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import ContinueButton from "./ContinueButton";

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from("members")
    .select("id, first_name, last_name, status, title")
    .eq("email", user.email)
    .single();

  if (!member) redirect("/login");
  if (member.status !== "active") redirect("/dashboard");

  const greeting = member.title
    ? `Dear ${member.title} ${member.last_name},`
    : `Dear ${member.first_name},`;

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="bg-white rounded-xl border border-border p-8 sm:p-12">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-2">
            Geneva Polo Club
          </p>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-2">
            Welcome to the Social Member&rsquo;s Club!
          </h1>
          <div className="h-px w-16 bg-sky mx-auto mt-4" />
        </div>

        {/* Letter body */}
        <div className="font-body text-sm leading-relaxed text-marine/80 space-y-5">
          <p>{greeting}</p>

          <p>
            We are pleased to welcome you to the Geneva Polo Club as a new member of our exclusive community! Your membership in our Social Membership program now grants you access to a world of elegance, sport, and camaraderie within our club.
          </p>

          <p>
            Your Social Membership grants you full access to our regular events and tournaments all year round, along with exclusive benefits like entry to our VIP lodge, invitations for your guests, and more. We look forward to your presence at our upcoming events and to creating lasting memories together.
          </p>

          <p>
            By becoming a member of our club, you are entering a unique and vibrant community. We trust that you will connect with other individuals who share your passions and that you will partake in rewarding experiences. We firmly believe that you will discover within our midst not just a sports club, but a genuine family committed to polo and our exclusive lifestyle.
          </p>

          <p>
            Moreover, as a member, you have the chance to extend this exclusive experience to your family and friends. If you are aware of someone who may be interested in becoming a part of the Social Club, please do not hesitate to inform us. Your recommendations are welcome as we wish to grow our community by adding other unique and inspirational individuals like yourself.
          </p>

          <p>
            We would like to thank you for supporting the club as well as for our impact partners who receive 10% of all social membership fees.
          </p>

          <p className="font-semibold text-marine">
            Please find your digital membership card in your Digital Clubhouse and join the Geneva Polo Club WhatsApp Community to receive practical infos &amp; offers:
          </p>

          <p>
            <a
              href="https://chat.whatsapp.com/JuKTd9XCImL5tZjwYId48v"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-dark underline underline-offset-4 hover:text-marine transition-colors"
            >
              Join WhatsApp Community &rarr;
            </a>
          </p>

          <p>Hoping to see you soon at the club!</p>

          <div className="pt-4">
            <p>With our sincerest regards,</p>
            <p className="font-semibold text-marine mt-2">Coast Sullenger, President</p>
            <p className="text-xs text-muted-foreground">Geneva Polo Club</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-border text-center space-y-4">
          <ContinueButton />
          <p className="text-xs text-muted-foreground font-body">
            You can revisit this letter anytime from your dashboard.
          </p>
        </div>

        <div className="mt-8 pt-4 border-t border-border/50 text-xs text-muted-foreground font-body italic text-center">
          GPC Field: 520 chemin du pont de Cr&eacute;vy, 74140 Veigy-Foncenex, France / info@genevapolo.com
        </div>
      </div>
    </div>
  );
}
