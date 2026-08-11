import { getWaiver, type WaiverLanguage } from "@/lib/events/waiver";

// Renders the bilingual liability waiver text (title / intro / numbered clauses) in a
// scrollable box. Pure (no hooks), so it is safe inside client or server components.
//
// Its one consumer is components/events/WaiverModal.tsx, which is the single presentation
// of the waiver everywhere it is accepted. Rendering this component is therefore NOT on its
// own enough to make two surfaces equivalent: the same text under different chrome, or
// behind a different acceptance gesture, still produces records that claim the same
// WAIVER_VERSION while meaning different things. `textSize` / `maxHeightClass` exist for
// layout only. If you are about to render this from somewhere new, render WaiverModal
// instead — see docs/solutions/architecture-patterns/a-content-hash-attests-to-the-text-not-the-presentation.md.
export default function WaiverText({
  lang,
  textSize = "text-sm",
  maxHeightClass = "max-h-56",
}: {
  lang: WaiverLanguage;
  textSize?: string;
  maxHeightClass?: string;
}) {
  const waiver = getWaiver(lang);
  return (
    <div
      className={`overflow-y-auto rounded-lg border border-border bg-white p-3 font-body text-marine ${textSize} ${maxHeightClass}`}
    >
      <h3 className="font-heading font-bold text-marine">{waiver.title}</h3>
      <p className="mt-1 mb-3">{waiver.intro}</p>
      <ol className="space-y-3 list-decimal pl-4">
        {waiver.clauses.map((clause, i) => (
          <li key={i}>
            <span className="font-semibold">{clause.heading}</span>
            {clause.paragraphs.map((p, j) => (
              <p key={j} className="mt-1">
                {p}
              </p>
            ))}
            {clause.bullets && (
              <ul className="list-disc pl-5 mt-1">
                {clause.bullets.map((b, k) => (
                  <li key={k}>{b}</li>
                ))}
              </ul>
            )}
            {clause.closing && <p className="mt-1">{clause.closing}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
