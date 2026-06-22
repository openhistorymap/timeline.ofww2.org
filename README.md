# timeline.ofww2.org

An interactive timeline of the **Second World War** (1939–1945), drawn from
[Wikidata](https://www.wikidata.org) and rendered with the
[timel.in](https://github.com/openhistorymap/timelin) timeline core.

- Every Wikidata item that is *part of* WWII with a date — battles, operations,
  campaigns, etc. — laid out as **swimlanes by type or by country**.
- Click an event for its Wikidata description, image, and Wikipedia link.
- Drag to pan, scroll to zoom, **Play** to scrub through the war.

## Build

```bash
npm install
npm run build        # → dist/  (deployed to GitHub Pages via .github/workflows)
npm run dev          # local dev server
```

## Data

Events are **pre-baked** to `public/events.json` (no WDQS calls at runtime).
Refresh from Wikidata whenever you like and commit the result:

```bash
python3 scripts/build_events.py     # WW2 = Q362
```

The renderer (`src/app.ts`) and the timel.in core (`lib/core/`, vendored) are
shared verbatim with `timeline.ofww1.org`; only `src/main.ts`, `public/events.json`
and `public/CNAME` differ.

MIT © OpenHistoryMap
