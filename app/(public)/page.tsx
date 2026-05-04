import Link from "next/link";
import Image from "next/image";
import {
  Wine,
  CalendarHeart,
  Handshake,
  Trophy,
  Smartphone,
  Flame,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";

const APPLY_URL = "/apply/GPC-2026";

const benefits = [
  {
    icon: Wine,
    title: "Fieldside Lounge",
    description:
      "Your privileged field-side lounge to enjoy the matches. A private members' area where the action rumbles in the backdrop. Coffee and croissants, or a Mimosa on Saturday & Sunday mornings, a glass of something tasty on Wednesday evenings. We welcome you to meet the community in this warm vibe and setting!",
  },
  {
    icon: CalendarHeart,
    title: "Social Calendar",
    description:
      "Beyond polo: long-table dinners, wine and cigar tastings, fireside chats with guest speakers, lounge music evenings, and seasonal celebrations. Events designed for authentic connection, not superficial \"networking\".",
  },
  {
    icon: Handshake,
    title: "Partner Benefits",
    description:
      "Preferential rates and exclusive offers from the club's curated partners, spanning hospitality, luxury, wellness, lifestyle, travel and more. Tangible value that extends beyond the field!",
  },
  {
    icon: Trophy,
    title: "The Sport",
    description:
      "Whether you ride or simply come for the atmosphere, the sport provides a rhythm and a reason to gather. Polo school available for those drawn in by the experience. Two major tournaments per season.",
  },
  {
    icon: Smartphone,
    title: "Digital Membership Card",
    description:
      "Your personal membership card with QR verification: access to events, partner benefits, and the member portal from your phone.",
  },
  {
    icon: Flame,
    title: "Regular Asados",
    description:
      "An Argentine tradition brought to the field, slow-cooked over open embers, served at long tables under the open sky. Every two weeks, the smoke rises and the club gathers around. A great opportunity to meet other members in a convivial atmosphere.",
  },
];

const galleryImages = [
    { src: "/images/Website/0P0A4314-scaled.jpg", alt: "Polo in action" },
  { src: "/images/Website/Specators-3-scaled.jpg", alt: "Members watching fieldside" },
  { src: "/images/Website/0P0A4893-scaled.jpg", alt: "The sport" },
  { src: "/images/Website/match-day.jpg", alt: "Kids on horses" },
  { src: "/images/Website/IMG_5470-scaled.jpg", alt: "The Bar" },
  { src: "/images/Website/chesterfield-lounge.jpg", alt: "The fieldside lounge" },
];

/* ── Decorative SVG ornament — crossed polo mallets ── */
function Ornament({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-4 ${className}`}>
      <div className="h-px w-12 sm:w-20 bg-current opacity-30" />
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        className="opacity-40"
      >
        {/* Crossed mallets */}
        <line x1="6" y1="26" x2="26" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="26" y1="26" x2="6" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        {/* Mallet heads */}
        <rect x="24" y="3" width="6" height="2" rx="1" transform="rotate(45 24 5)" fill="currentColor" />
        <rect x="3" y="5" width="6" height="2" rx="1" transform="rotate(-44 6 7)" fill="currentColor" />
        {/* Ball */}
        <circle cx="16" cy="16" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
      <div className="h-px w-12 sm:w-20 bg-current opacity-30" />
    </div>
  );
}

/* ── Thin decorative rule ── */
function Rule({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <div className="h-px w-8 bg-current opacity-20" />
      <div className="w-1.5 h-1.5 rounded-full bg-current opacity-30" />
      <div className="h-px w-8 bg-current opacity-20" />
    </div>
  );
}

interface UpcomingHighlight {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  visibility: string | null;
  image_url: string | null;
  image_url_2: string | null;
  images: unknown;
  type_name: string;
  type_color: string;
  type_sort_order: number;
}

function highlightHero(e: UpcomingHighlight): string | null {
  if (Array.isArray(e.images)) {
    const first = e.images.find(
      (u): u is string => typeof u === "string" && u.length > 0
    );
    if (first) return first;
  }
  return e.image_url || e.image_url_2 || null;
}

function formatHighlightDate(
  startDate: string,
  endDate: string | null,
  monthOnly: boolean
): string {
  const start = new Date(startDate);
  const startMonth = start.toLocaleDateString("en-GB", { month: "long" });
  const startYear = start.getFullYear();
  if (monthOnly) {
    return `${startMonth} ${startYear}`;
  }
  const startDay = start.getDate();
  if (!endDate || endDate === startDate) {
    return `${startDay} ${startMonth} ${startYear}`;
  }
  const end = new Date(endDate);
  const endDay = end.getDate();
  const endMonth = end.toLocaleDateString("en-GB", { month: "long" });
  if (startMonth === endMonth) {
    return `${startDay}–${endDay} ${startMonth} ${startYear}`;
  }
  return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${startYear}`;
}

async function fetchUpcomingHighlights(): Promise<UpcomingHighlight[]> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, title, start_date, end_date, location, visibility, image_url, image_url_2, images, event_type_id"
    )
    .eq("is_published", true)
    .gte("start_date", today)
    .order("start_date", { ascending: true });

  if (!events || events.length === 0) return [];

  const { data: types } = await supabase
    .from("event_types")
    .select("id, name, color, sort_order");

  const typeMap = new Map(
    (types ?? []).map((t) => [t.id, t] as const)
  );

  const seen = new Set<string>();
  const highlights: UpcomingHighlight[] = [];
  for (const e of events) {
    if (!e.event_type_id || seen.has(e.event_type_id)) continue;
    const t = typeMap.get(e.event_type_id);
    if (!t) continue;
    seen.add(e.event_type_id);
    highlights.push({
      id: e.id,
      title: e.title,
      start_date: e.start_date,
      end_date: e.end_date,
      location: e.location,
      visibility: e.visibility,
      image_url: e.image_url,
      image_url_2: e.image_url_2,
      images: e.images,
      type_name: t.name,
      type_color: t.color,
      type_sort_order: t.sort_order,
    });
  }
  highlights.sort((a, b) => a.type_sort_order - b.type_sort_order);
  return highlights;
}

interface OpenDoorsPromo {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  location: string | null;
  description: string | null;
  hero: string | null;
}

async function fetchOpenDoorsPromo(): Promise<OpenDoorsPromo | null> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, location, description, image_url, image_url_2, images"
    )
    .eq("is_published", true)
    .eq("visibility", "public")
    .gte("start_date", today)
    .ilike("title", "%open doors%")
    .order("start_date", { ascending: true })
    .limit(1);

  const e = events?.[0];
  if (!e) return null;

  const heroFromArray = Array.isArray(e.images)
    ? (e.images.find((u): u is string => typeof u === "string" && u.length > 0) ?? null)
    : null;
  const hero = heroFromArray || e.image_url || e.image_url_2 || null;

  return {
    id: e.id,
    title: e.title,
    start_date: e.start_date,
    end_date: e.end_date,
    start_time: e.start_time,
    location: e.location,
    description: e.description,
    hero,
  };
}

export default async function HomePage() {
  const [upcomingHighlights, openDoors] = await Promise.all([
    fetchUpcomingHighlights(),
    fetchOpenDoorsPromo(),
  ]);
  return (
    <>
      {/* ── Hero ── */}
      <section className="text-white relative overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/Website/0P0A4893-scaled.jpg')" }}
        />
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-marine/80" />
        <div className="relative mx-auto max-w-5xl px-6 py-28 sm:py-36 lg:py-44 text-center">
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky mb-6">
            Geneva Polo Club
          </p>
          <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            A club that feels like home
          </h1>
          <Ornament className="text-sky mb-8" />
          <p className="font-body text-lg sm:text-xl font-light text-white/60 max-w-2xl mx-auto mb-12">
            A private community built around the sport and lifestyle of polo.
          </p>
          <Link
            href={APPLY_URL}
            className="inline-block bg-sky text-marine font-body font-medium text-sm tracking-wide px-8 py-3.5 rounded-sm hover:bg-sky-light transition-colors"
          >
            Become a Member
          </Link>
        </div>
      </section>

      {/* ── The Club ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky mb-4">
            The Club
          </p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-8">
            More than a membership
          </h2>
          <p className="font-body text-base sm:text-lg leading-relaxed text-marine/70 mb-12">
            The Social Club is not a spectator tier or a hospitality
            package. It is the club&rsquo;s primary social layer, a private,
            vetted community where international professionals, creatives, and
            families gather around the sport and lifestyle of polo on a
            30-hectare regenerative estate outside Geneva.
          </p>
          <blockquote className="border-l-2 border-sky pl-6 text-left max-w-xl mx-auto">
            <p className="font-heading text-lg sm:text-xl italic text-marine/80 leading-relaxed mb-4">
              &ldquo;We didn&rsquo;t set out to build an ultra-luxury club. We
              are clearly exclusive but more over authentic and natural, a
              place where people can relax find positive vibes and real
              connections, fieldside, with good food &amp; drink, horses
              and the open sky.&rdquo;
            </p>
            <cite className="font-body text-sm text-marine/50 not-italic">
              The Founders
            </cite>
          </blockquote>
        </div>
      </section>

      {/* ── Open Doors promo ── */}
      {openDoors && (
        <section className="bg-cream">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <article className="grid grid-cols-1 lg:grid-cols-2 bg-white rounded-sm border border-border/60 overflow-hidden">
              <div className="aspect-[4/3] lg:aspect-auto bg-marine">
                {openDoors.hero ? (
                  <img
                    src={openDoors.hero}
                    alt={openDoors.title}
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>
              <div className="p-8 sm:p-10 flex flex-col justify-center">
                <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-3">
                  An Invitation
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-3 leading-tight">
                  {openDoors.title}
                </h2>
                <p className="font-body text-base font-semibold text-sky-dark mb-2">
                  {formatHighlightDate(openDoors.start_date, openDoors.end_date, false)}
                  {openDoors.start_time
                    ? ` · ${openDoors.start_time.slice(0, 5)}`
                    : ""}
                </p>
                {openDoors.location && (
                  <p className="font-body text-sm text-muted-foreground mb-4">
                    {openDoors.location}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-4 mt-6">
                  <Link
                    href={`/public/events/${openDoors.id}`}
                    className="inline-block px-6 py-3 rounded-full bg-marine text-white font-body font-medium text-sm hover:bg-marine-light transition-colors cursor-pointer"
                  >
                    Register →
                  </Link>
                  <Link
                    href={`/public/events/${openDoors.id}`}
                    className="font-body text-sm text-sky-dark underline underline-offset-4 hover:text-marine transition-colors"
                  >
                    See full details
                  </Link>
                </div>
              </div>
            </article>
          </div>
        </section>
      )}

      {/* ── Benefits — card grid ── */}
      <section className="bg-marine text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(149,206,225,0.06)_0%,_transparent_60%)]" />
        <div className="relative mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="text-center mb-14">
            <p className="font-accent text-base tracking-[0.3em] uppercase text-sky mb-4">
              Membership
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">
              What&rsquo;s included
            </h2>
            <Rule className="text-sky" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {benefits.map((benefit) => (
              <div
                key={benefit.title}
                className="border border-white/10 rounded-sm p-6 sm:p-8 hover:border-sky/30 transition-colors group"
              >
                <div className="flex items-center gap-3 mb-4">
                  <benefit.icon className="w-5 h-5 text-sky flex-shrink-0 group-hover:text-sky-light transition-colors" />
                  <h3 className="font-body font-medium text-white text-base sm:text-lg">
                    {benefit.title}
                  </h3>
                </div>
                <p className="font-body text-sm leading-relaxed text-white/50">
                  {benefit.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Upcoming highlights — one per event type ── */}
      {upcomingHighlights.length > 0 && (
        <section className="bg-cream">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
            <div className="text-center mb-12">
              <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-4">
                On the Calendar
              </p>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-4">
                What&rsquo;s coming up
              </h2>
              <Rule className="text-marine" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {upcomingHighlights.slice(0, 4).map((event) => {
                const isMembersOnly = event.visibility !== "public";
                const dateLabel = formatHighlightDate(
                  event.start_date,
                  event.end_date,
                  isMembersOnly
                );
                const hero = highlightHero(event);
                const cta = isMembersOnly ? (
                  <Link
                    href={APPLY_URL}
                    className="inline-block mt-3 text-xs font-body font-medium text-marine underline underline-offset-4 hover:text-sky-dark transition-colors"
                  >
                    Apply for membership →
                  </Link>
                ) : (
                  <Link
                    href={`/public/events/${event.id}`}
                    className="inline-block mt-3 text-xs font-body font-medium text-marine underline underline-offset-4 hover:text-sky-dark transition-colors"
                  >
                    View event →
                  </Link>
                );
                return (
                  <article
                    key={event.id}
                    className="bg-white rounded-sm border border-border/60 overflow-hidden flex flex-col"
                  >
                    {hero ? (
                      <div className="aspect-square bg-cream/50">
                        <img
                          src={hero}
                          alt={event.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="aspect-square bg-cream/60" />
                    )}
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-body bg-marine/5 text-marine">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: event.type_color }}
                          />
                          {event.type_name}
                        </span>
                        {isMembersOnly && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-body font-medium bg-sky/10 text-sky-dark">
                            Members only
                          </span>
                        )}
                      </div>
                      <p className="font-body text-xs font-semibold text-sky-dark">
                        {dateLabel}
                      </p>
                      <h3 className="font-heading text-base font-bold text-marine mt-1 leading-snug">
                        {event.title}
                      </h3>
                      {!isMembersOnly && event.location && (
                        <p className="text-xs font-body text-muted-foreground mt-1">
                          {event.location}
                        </p>
                      )}
                      <div className="mt-auto">{cta}</div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="text-center mt-10">
              <Link
                href="/public/events"
                className="inline-block px-5 py-2.5 rounded-full bg-marine text-white font-body font-medium text-sm hover:bg-marine-light transition-colors"
              >
                See all upcoming events →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Nature & Community — split panel ── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Left — Nature & Wellbeing */}
          <div className="bg-white px-6 sm:px-12 lg:px-16 py-20 sm:py-28">
            <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-4">
              Nature & Wellbeing
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-6">
              Where wellness happens on its own
            </h2>
            <Rule className="text-marine justify-start mb-6" />
            <p className="font-body text-base leading-relaxed text-marine/60 mb-6">
              Thirty hectares of regenerative farmland, open fields, and over
              a hundred horses. The land is managed with care: organic,
              regenerative, respectful of the natural balance.
            </p>
            <p className="font-body text-base leading-relaxed text-marine/60 mb-4">
              Within the grounds, The Holistic Space offers a destination for
              tranquility and self-discovery, including the traditional
              Russian banya beside a tranquil pond. Wellness here isn&rsquo;t
              a programme. It&rsquo;s what happens when you spend your
              weekends outdoors, among horses, in good company.
            </p>
            <Link
              href="https://www.holisticspace.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-body text-sm text-sky-dark underline underline-offset-4 hover:text-marine transition-colors"
            >
              Discover The Holistic Space →
            </Link>
          </div>

          {/* Right — The Community */}
          <div className="bg-white px-6 sm:px-12 lg:px-16 py-20 sm:py-28 lg:border-l border-border/40">
            <p className="font-accent text-base tracking-[0.3em] uppercase text-sky mb-4">
              The Community
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-6">
              A circle worth joining
            </h2>
            <Rule className="text-marine justify-start mb-6" />
            <p className="font-body text-base leading-relaxed text-marine/60 mb-6">
              What makes the community hard to describe is what makes it
              worth joining. The conversations cross languages and borders.
              The friendships form quickly and run deep, because when people
              feel at ease, they skip the small talk.
            </p>
            <p className="font-body text-base leading-relaxed text-marine/60">
              We vet for trust, not for titles. The result is a circle of
              people who make you put your phone away, because what&rsquo;s
              happening around you is simply more interesting.
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="bg-marine text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(149,206,225,0.06)_0%,_transparent_60%)]" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
          <Ornament className="text-sky mb-10" />
          <h2 className="font-heading text-3xl sm:text-4xl font-bold mb-6">
            Join us fieldside
          </h2>
          <p className="font-body text-lg font-light text-white/60 mb-10 max-w-xl mx-auto">
            The best way to understand the club is to spend an afternoon here.
          </p>
          <Link
            href={APPLY_URL}
            className="inline-block bg-sky text-marine font-body font-medium text-sm tracking-wide px-8 py-3.5 rounded-sm hover:bg-sky-light transition-colors"
          >
            Become a Member
          </Link>
        </div>
      </section>

      {/* ── Gallery ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="text-center mb-12">
            <p className="font-accent text-base tracking-[0.3em] uppercase text-sky mb-4">
              Fieldside
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-4">
              The atmosphere
            </h2>
            <Rule className="text-marine" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {galleryImages.map((img) => (
              <div
                key={img.src}
                className="aspect-[4/3] rounded-sm overflow-hidden"
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  width={800}
                  height={600}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The Season ── */}
      <section className="bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
          <Ornament className="text-marine mb-10" />
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-4">
            The Season
          </p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-8">
            April through September
          </h2>
          <p className="font-body text-base sm:text-lg leading-relaxed text-marine/70">
            The season opens in April. By June, the fields are full: thirty
            players, a hundred horses, and Wednesday evenings that go longer
            than planned. Saturday mornings begin with coffee, croissants, and
            a training match worth watching. The calendar moves with the
            rhythm of the sport: match days, long-table dinners, fireside
            chats, and the kind of Sunday afternoons that make you forget
            about Monday.
          </p>
        </div>
      </section>
    </>
  );
}
