/**
 * Normalise rich-text composer output (TipTap) before it is stored and sent.
 *
 * The composer emits one `<p>` per line and represents a blank line as an
 * empty paragraph (`<p></p>`). The email layout renders the rich body with
 * `.rich-body p { margin: 0 }`, so paragraphs stack tightly and spacing comes
 * from the blank lines the author inserts — mirroring what they see in the
 * editor. Two adjustments make that robust:
 *
 *   1. Empty paragraphs collapse to zero height in Outlook, so a blank line
 *      would simply vanish. Give each one a non-breaking space so it renders
 *      as exactly one blank line in every client.
 *   2. A double-tap of Enter (or pasted content) can produce runs of empty
 *      paragraphs; collapse any run to a single blank line so spacing stays
 *      even and never balloons into a big gap.
 *
 * Paragraphs with real content (including inline markup like `<em>`) are left
 * untouched. Only attribute-free `<p>` tags — exactly what the composer emits —
 * are considered; the template's own styled paragraphs are never in this string.
 */
export function normalizeRichBody(html: string): string {
  if (!html) return html;
  return html
    // A paragraph holding only whitespace, &nbsp;, or a lone <br> is a
    // blank-line spacer → give it a non-breaking space so it keeps its height.
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "<p>&nbsp;</p>")
    // Collapse runs of 2+ spacers down to one blank line.
    .replace(/(?:<p>&nbsp;<\/p>\s*){2,}/gi, "<p>&nbsp;</p>");
}
