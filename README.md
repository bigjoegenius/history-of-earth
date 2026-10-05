# History of Earth

A time-travelling, Google-Earth-style globe covering 4.567 billion years: the planet's formation,
drifting continents, ice ages, the origin and evolution of life, and human history with kingdoms,
borders and events. Scrub or play through time; events appear in the side panel with short
explanations and a "learn more" drawer backed by Wikipedia.

Built with CesiumJS, Vite and TypeScript. No API keys are needed: imagery comes from NASA GIBS
(Blue Marble) with optional Esri World Imagery when zoomed in, plate reconstructions from the
GPlates Web Service (Merdith et al. 2021), and historical borders from the historical-basemaps
project plus Natural Earth.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## Regenerate the data snapshots

The reconstructed coastlines and historical borders under `public/data/` are committed so the
site is self-contained. To rebuild them from their sources:

```bash
npm run data:paleo
```

```bash
npm run data:borders
```

Reconstruct the palaeo-positions of deep-time events (adds `paleoLat`/`paleoLon` so markers sit on
the reconstructed continents rather than at present-day coordinates):

```bash
npm run data:points
```

Validate the content files after editing them:

```bash
npm run data:validate
```

```bash
npm run data:chapters
```

## Build and deploy

```bash
npm run build
```

`dist/` is a static site. Deploy it to any static host (Netlify, Vercel, GitHub Pages,
Cloudflare Pages, S3). The app uses absolute paths (`/cesium/…`, `/data/…`), so serve it from
the domain root or set Vite's `base` option if it lives under a sub-path.

## Content principles

- Mainstream, well-sourced science and history; dating uncertainty and genuine debates are stated.
- Fringe theories are included for interest but are always labelled "Fringe theory" with a note
  on what mainstream scholarship says (`consensus: "fringe"` + `mainstreamView` in the data).
- Deep-time globe views are labelled by their source: satellite imagery, plate-model
  reconstruction, or illustrative (procedural) when no reliable reconstruction exists.

See `SPEC.md` for the architecture, data contracts and authoring rules.

## Sources and licences

- NASA Global Imagery Browse Services (Blue Marble) — public domain.
- Esri World Imagery — © Esri, Maxar, Earthstar Geographics (attribution required).
- GPlates Web Service, Merdith et al. 2021 plate model — CC BY.
- historical-basemaps (aourednik) — GPL-3.0.
- Natural Earth — public domain.
- Wikipedia extracts — CC BY-SA 4.0.
- CesiumJS — Apache-2.0.
