# public/data — generated map data

Everything in this folder is produced by two scripts and committed so the site is fully static
(no API keys, no runtime calls to third-party geodata services). Do not edit these files by hand;
re-run the scripts instead.

```
public/data/
  paleo/
    index.json               PaleoIndex (src/types.ts)
    coastlines_<age>.json    reconstructed coastlines, <age> in Ma (0 … 1000)
    boundaries_<age>.json    plate boundaries for the same ages
  borders/
    index.json               BordersIndex (src/types.ts)
    world_<year>.json        political borders; <year> uses the app's YEAR CONVENTION
  README.md
```

All geometry is GeoJSON (WGS84 lon/lat degrees) written compactly with no whitespace.

## Palaeogeography — `paleo/`

**Source.** [GPlates Web Service](https://gws.gplates.org) (EarthByte Group, University of Sydney),
`reconstruct/coastlines` and `topology/plate_boundaries` endpoints with `model=MERDITH2021`:

> Merdith, A. S., Williams, S. E., Collins, A. S., Tetley, M. G., Mulder, J. A., Blades, M. L.,
> Young, A., Armistead, S. E., Cannon, J., Zahirovic, S. & Müller, R. D. (2021). *Extending
> full-plate tectonic models into deep time: Linking the Neoproterozoic and the Phanerozoic.*
> Earth-Science Reviews 214, 103477. https://doi.org/10.1016/j.earscirev.2020.103477

Credit the model and the service wherever the maps are shown (the app's credits footer does).
The index carries the attribution string
`Merdith et al. 2021 plate model via GPlates Web Service (gws.gplates.org)`.

**Snapshots.** Every 5 Myr from 0 to 540 Ma, then every 20 Myr from 560 to 1000 Ma (the model's
limit): 132 ages. `index.json` lists only ages whose file exists, ascending.

**Coastline files.** A FeatureCollection holding **one** Feature whose geometry is a
`MultiPolygon` (properties `{}`). GPlates returns one property-less polygon per terrane
fragment; merging them saves roughly a third of the bytes. Processing:

- Douglas–Peucker simplification with `@turf/simplify` (`highQuality: false`), starting at a
  0.15° tolerance; while a file is over 150 KB the tolerance is raised in 1.25× steps.
  Younger reconstructions contain more fragments, so the current files use 0.46° for
  0–65 Ma, 0.37° for 70–180 Ma, 0.29° for 185–410 Ma, 0.19° for 415–600 Ma and 0.15°
  for 620–1000 Ma (97–150 KB per file, ~18 MB in total; boundaries add ~2.6 MB);
- coordinates rounded to 2 decimals; rings with fewer than 4 points dropped;
- polygons and holes smaller than 0.05 square degrees (planar shoelace area) dropped.

The polygons are *fragments* that abut one another (continents are mosaics of terranes), so
draw them as fills without outlines — stroking every polygon shows the internal seams.
Polygons are pre-split at the antimeridian (±179.99°).

**Boundary files.** A FeatureCollection of `LineString` / `MultiLineString` features with
properties `{ type }`, the GPlates topology type: `MidOceanRidge`, `SubductionZone`,
`Transform`, `ContinentalRift`, `Fault`, `TerraneBoundary`, `InferredPaleoBoundary`,
`ExtendedContinentalCrust`, `UnclassifiedFeature`, … Simplified at 0.15°, 2 decimals.
They exist for every age in `agesMa`, so `plateBoundaries` in the index resolves with the
same `{age}` as the coastlines. The script only advertises `plateBoundaries` when that holds.

## Political borders — `borders/`

**Sources.**
- [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)
  (`geojson/world_<tag>.geojson`, 54 snapshots from 123,000 BCE to 2010 CE), licensed
  **GPL-3.0**. The derived files in this folder are therefore also distributed under GPL-3.0.
  The borders are approximate by nature; consult the project for its sources and caveats.
- [Natural Earth](https://www.naturalearthdata.com) 1:110m Admin-0 countries
  (via `nvkelso/natural-earth-vector`), **public domain**, used for `world_2026.json`
  ("today").

The index carries `historical-basemaps by aourednik (GPL-3.0); Natural Earth (public domain)`.

**File names.** The source tag becomes a year on the app's continuous axis:
`world_bc123000` → `world_-123000.json`, `world_bc1` → `world_-1.json`,
`world_1492` → `world_1492.json`. `index.json` lists the years ascending.

**Properties** (`BorderFeatureProps` in `src/types.ts`, plus `precision`):

| property    | from (historical-basemaps) | notes |
|-------------|----------------------------|-------|
| `name`      | `NAME`                     | features without a name (unclaimed land) are dropped |
| `subject`   | `SUBJECTO`                 | the polity it answers to; **omitted when equal to `name`** |
| `partOf`    | `PARTOF`                   | wider cultural/political grouping; **omitted when equal to `name`** |
| `precision` | `BORDERPRECISION`          | 1 = approximate, 2 = moderately precise, 3 = determined by law |

Treat a missing `subject` / `partOf` as "same as `name`". For Natural Earth, `name` is `NAME`
(NE's short display name, e.g. "Dem. Rep. Congo") and `subject` is `SOVEREIGNT` for
dependencies only (Greenland → Denmark); territories NE marks as "Indeterminate" get none.

**Geometry.** Always `MultiPolygon`. Simplified with `@turf/simplify` at 0.05° and rounded to
3 decimals; a file over 400 KB gets a coarser tolerance (1.25× steps) — in practice only
`world_1492.json`, which maps ~1,300 indigenous nations of the Americas (0.24°). Files are
20–390 KB, ~10.7 MB in total. Parts smaller
than 0.001 square degrees are dropped except each feature's largest part, so micro-states survive.

Note on content: the source's 1492 snapshot depicts the Americas as indigenous nations
(e.g. "Quechua", "Nahua (Mexico)") rather than empires; "Inca Empire" and "Aztec Empire"
appear in `world_1500.json`.

## Regenerating

```sh
npm run data:paleo      # node scripts/fetch-paleo.mjs   (~15 min; 3 concurrent requests)
npm run data:borders    # node scripts/fetch-borders.mjs (~1 min; ~70 MB downloaded)
```

Both scripts are idempotent: files that already exist are kept (so re-running only fills
gaps after a failure) and the index is rebuilt from what is on disk. Flags:

- `--force` — re-download and overwrite everything;
- `fetch-paleo.mjs --ages=0,5,200` — only those ages; `--no-boundaries` — coastlines only.

Requests time out after 60 s and are retried 4 times with exponential backoff. Each run
ends with a summary table (file, feature or polygon count, KB) and exits non-zero if any
file failed. The borders script reads the snapshot list from the GitHub contents API
(rate-limited) and falls back to a built-in list. Shared helpers live in
`scripts/lib/geo-pipeline.mjs`.
