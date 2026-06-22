import { getWaiver, type WaiverLanguage } from "@/lib/events/waiver";

// Renders the bilingual liability waiver text (title / intro / numbered clauses) in a
// scrollable box. Pure (no hooks), so it is safe inside client or server components.
// Shared by the self-registration form and the door check-in flows (scan + lost-QR)
// so the exact same text — and therefore the same WAIVER_VERSION — is shown wherever
// a guest accepts it. `textSize` / `maxHeightClass` let the door use larger, outdoor-
// readable text and a taller box than the compact self-reg box.
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
