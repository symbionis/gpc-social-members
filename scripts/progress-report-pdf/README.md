# Platform progress report PDF

Builds `docs/reporting/GPC_Platform_Progress_Report_June_August_2026.pdf` in the same house format as
the roadmap. Prose lives in `_content.py`; `build.py` reuses the roadmap build's fonts, logo
and stylesheet and appends a stats table.

    python3 scripts/progress-report-pdf/build.py
    node    scripts/progress-report-pdf/render.js
    pdfunite docs/reporting/_rcover.pdf docs/reporting/_rbody.pdf docs/reporting/GPC_Platform_Progress_Report_June_August_2026.pdf
    rm -f docs/reporting/_rcover.pdf docs/reporting/_rbody.pdf docs/reporting/_report_cover.html docs/reporting/_report_body.html

Note: `build.py` is generated from `scripts/roadmap-pdf/build.py` plus `_content.py`. If the
roadmap build's stylesheet changes, regenerate rather than editing `build.py` by hand. Any `%`
in added CSS must be written `%%` — the stylesheet is a Python format string.
