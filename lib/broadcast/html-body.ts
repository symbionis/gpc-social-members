/** True when HTML has no text content after stripping tags. The shared
 *  "is the message body empty?" rule used by the broadcast validator, the
 *  event-message validator, and the composer's send gate, so the definition of
 *  "empty" can't drift between them. */
export function isHtmlBodyEmpty(html: string): boolean {
  return !html || html.replace(/<[^>]+>/g, "").trim().length === 0;
}
