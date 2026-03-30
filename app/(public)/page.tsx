import Link from "next/link";
import {
  Wine,
  CalendarHeart,
  Handshake,
  Trophy,
  Smartphone,
} from "lucide-react";

const APPLY_URL = "/apply/FRANK-GPC-2026";

const benefits = [
  {
    icon: Wine,
    title: "Fieldside Lounge",
    description:
      "Your spot by the field. A private members' area where the match is the backdrop, not the main event. Coffee and croissants on Saturday mornings, a glass of something good on Wednesday evenings.",
  },
  {
    icon: CalendarHeart,
    title: "Social Calendar",
    description:
      "Beyond polo — long-table dinners, wine and cigar tastings, fireside chats with guest speakers, lounge music evenings, and seasonal celebrations. Events designed for conversation, not networking.",
  },
  {
    icon: Handshake,
    title: "Partner Benefits",
    description:
      "Preferential rates and exclusive access from the club's curated partners — spanning hospitality, wellness, lifestyle, and travel. Tangible value that extends beyond the field.",
  },
  {
    icon: Trophy,
    title: "The Sport",
    description:
      "Whether you ride or simply come for the atmosphere — the sport provides a rhythm and a reason to gather. Polo school available for those drawn in by the experience. Two major tournaments per season.",
  },
  {
    icon: Smartphone,
    title: "Digital Membership Card",
    description:
      "Your personal membership card with QR verification — access to events, partner benefits, and the member portal from your phone.",
  },
];

const galleryPlaceholders = Array.from({ length: 6 }, (_, i) => i);

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

export default function HomePage() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="bg-marine text-white relative overflow-hidden">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(149,206,225,0.08)_0%,_transparent_70%)]" />
        <div className="relative mx-auto max-w-5xl px-6 py-28 sm:py-36 lg:py-44 text-center">
          <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky mb-6">
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
          <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky mb-4">
            The Club
          </p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-8">
            More than a membership
          </h2>
          <p className="font-body text-base sm:text-lg leading-relaxed text-marine/70 mb-12">
            The Social Member Club is not a spectator tier or a hospitality
            package. It is the club&rsquo;s primary social layer — a private,
            vetted community where international professionals, creatives, and
            families gather around the sport and lifestyle of polo on a
            30-hectare regenerative estate outside Geneva.
          </p>
          <blockquote className="border-l-2 border-sky pl-6 text-left max-w-xl mx-auto">
            <p className="font-heading text-lg sm:text-xl italic text-marine/80 leading-relaxed mb-4">
              &ldquo;We didn&rsquo;t set out to build an exclusive club. We
              wanted to create a place where people put their guard down and
              connect for real — fieldside, around good food, with the horses
              and the open sky.&rdquo;
            </p>
            <cite className="font-body text-sm text-marine/50 not-italic">
              — The Founders
            </cite>
          </blockquote>
        </div>
      </section>

      {/* ── Benefits — card grid ── */}
      <section className="bg-marine text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(149,206,225,0.06)_0%,_transparent_60%)]" />
        <div className="relative mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="text-center mb-14">
            <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky mb-4">
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

      {/* ── Nature & Community — split panel ── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Left — Nature & Wellbeing */}
          <div className="bg-cream px-6 sm:px-12 lg:px-16 py-20 sm:py-28">
            <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-4">
              Nature & Wellbeing
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-6">
              Where wellness happens on its own
            </h2>
            <Rule className="text-marine justify-start mb-6" />
            <p className="font-body text-base leading-relaxed text-marine/60 mb-6">
              Thirty hectares of regenerative farmland, open fields, and over
              a hundred horses. The land is managed with care — organic,
              regenerative, respectful of the natural balance.
            </p>
            <p className="font-body text-base leading-relaxed text-marine/60">
              Within the grounds, The Holistic Space offers a destination for
              tranquility and self-discovery — including the traditional
              Russian banya beside a tranquil pond. Wellness here isn&rsquo;t
              a programme. It&rsquo;s what happens when you spend your
              weekends outdoors, among horses, in good company.
            </p>
          </div>

          {/* Right — The Community */}
          <div className="bg-white px-6 sm:px-12 lg:px-16 py-20 sm:py-28 lg:border-l border-border/40">
            <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky mb-4">
              The Community
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-6">
              A circle worth joining
            </h2>
            <Rule className="text-marine justify-start mb-6" />
            <p className="font-body text-base leading-relaxed text-marine/60 mb-6">
              What makes the community hard to describe is what makes it
              worth joining. The conversations cross languages and borders.
              The friendships form quickly and run deep — because when people
              feel at ease, they skip the small talk.
            </p>
            <p className="font-body text-base leading-relaxed text-marine/60">
              We vet for trust, not for titles. The result is a circle of
              people who make you put your phone away — because what&rsquo;s
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
            <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky mb-4">
              Fieldside
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-4">
              The atmosphere
            </h2>
            <Rule className="text-marine" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {galleryPlaceholders.map((i) => (
              <div
                key={i}
                className="aspect-[4/3] bg-marine/5 rounded-sm flex items-center justify-center"
              >
                <span className="text-marine/15 font-body text-sm">
                  Photo {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The Season ── */}
      <section className="bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
          <Ornament className="text-marine mb-10" />
          <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-4">
            The Season
          </p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-8">
            April through September
          </h2>
          <p className="font-body text-base sm:text-lg leading-relaxed text-marine/70">
            The season opens in April. By June, the fields are full — thirty
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
