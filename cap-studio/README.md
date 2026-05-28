# Cap Studio — Taxonomy QA Prototype (Internal)

Internal prototype for testing Beechfield Cap Studio product categorisation against the master workbook. Not a configurator, not a recommendation engine.

## Run locally

The page loads JSON via `fetch()` so it needs to be served, not opened from disk:

```
cd <repo root>
python3 -m http.server 8000
# then open http://localhost:8000/cap-studio/
```

## What's here

- `index.html` — single-page prototype: filters sidebar, results grid, scenario runner, feedback panel.
- `app.js` — filter logic, "Why this appears" lines, scenario preload, debug drawer, feedback capture / export.
- `styles.css` — mirrors the brand palette and typography used in the root `index.html` PDP mockup.
- `data/` — JSON generated from the master workbook.
  - `products.json` — full Product_Master, all 64 columns per product, multi-value cells split into arrays.
  - `filters.json` — Filter_Reference values per group; casing duplicates flagged.
  - `scenarios.json` — Test_Scenarios with filter arrays pre-split.
  - `field_definitions.json` — used for tooltip help text in the debug drawer.
- `scripts/convert_workbook.py` — regenerate the four JSON files when the workbook changes.

## Regenerate the data

```
pip install openpyxl
python3 cap-studio/scripts/convert_workbook.py /path/to/Beechfield_Cap_Studio_Master_Data_v1.xlsx
```

The script:

- preserves source values verbatim (no renaming — `Flat Peak` stays `Flat Peak`),
- preserves casing-only duplicates in `Filter_Reference` so the UI can surface them as QA issues,
- treats `n/a` and blank cells as null so missing-data flags work,
- splits semicolon-delimited Colour List / Size List / scenario filter cells into arrays.

## What this prototype deliberately does not do

- No recommendation scoring, no derived buyer tags (relaxed / premium / team-ready / etc.).
- No backend, no auth, no PIM integration.
- No production styling polish — clarity and feedback capture come first.

Feedback is stored in browser `localStorage` and can be exported as CSV (matches the `Feedback_Log_Template` column order) or JSON.
