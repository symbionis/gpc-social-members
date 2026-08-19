# Client roadmap PDF

Builds `docs/reporting/Geneva_Polo_Club_Delivery_Roadmap.pdf` — the client-facing version of
`docs/reporting/gpc-otm-roadmap.md`, in the house format used by the Platform Progress Report.

    python3 scripts/roadmap-pdf/build.py     # writes two HTML files into docs/
    node    scripts/roadmap-pdf/render.js    # renders each to PDF via Playwright
    pdfunite docs/reporting/_cover.pdf docs/reporting/_body.pdf docs/reporting/Geneva_Polo_Club_Delivery_Roadmap.pdf
    rm -f docs/reporting/_cover.pdf docs/reporting/_body.pdf docs/reporting/_roadmap_cover.html docs/reporting/_roadmap_body.html

## Why two documents

The cover bleeds to the paper edge, so it needs zero page margins. The body needs margins
plus a running band and footer. One document cannot have both, and `position: fixed`
furniture does not survive Chrome's print pagination — it lands in the wrong place and
collides with the text. So the cover and body render separately and are joined with
`pdfunite` (poppler).

The band and footer are Chrome header/footer templates, which is the only reliable way to
repeat them on every page and get real page numbers. Those templates are separate documents
and cannot see the fonts embedded in the page, so Poppins is re-declared inline in the
footer template.

## Content

The prose lives in `build.py`, deliberately rewritten from the working roadmap: no ticket
references, no supplier or system names, benefit-led. It does not track the markdown file
automatically — when the roadmap changes materially, update `build.py` too.

Brand: Playfair Display italic headings, Poppins body, marine `#052938`, sky `#95CEE1`,
fonts read from `app/fonts/`. Never abbreviate the club to three letters in client copy.
