# ArtemisTwin — frontend candidate 0.8.0-rc.1

Prepared 9 November 2026 for the project team. **Review candidate, not a published or scientifically certified release.**

## Run the frontend

Extract the frontend ZIP, then run from its folder:

```text
python serve.py --port 8080
```

Open **http://127.0.0.1:8080/**. Windows can also use `py -3 serve.py --port 8080`.
Do not open `site/index.html` with `file://`; the application fetches bundled JSON and worker assets over HTTP.
Python 3 is only a local preview server. The website itself is static and needs no runtime backend, login or API keys.

`site/` is the production root-path build. Give that directory's contents to the team's static host if/when hosting is selected.
The owner explicitly requested file delivery, no Git initialization/push and no publication. **No hosting provider, domain,
account or deployment destination has been selected or created.** Hosting and hosted verification remain with the team.

NASA GIBS basemap tiles and external source links need internet access. Bundled evidence and exports can continue in an
already-loaded session if connectivity drops; this is not a fully offline satellite-map application.

## What to review

Choose Moon South-Pole Ridge / Rover Mobility → Open Match Map → Mauna Ulu → Site Detail → inspect evidence and sources →
add sites to Portfolio & Gaps → compare both transects in Twin Viewer → export measurements and the verified Earth outline.

Only that pairing has a prepared target/Earth comparison. Other selections explicitly preserve site-only or missing evidence.
Fit, ranking and similarities are unset. Broad slope/roughness grids do not describe wheel-scale rocks or authorize field access.

Laboratory Context now sits below the portfolio's upper grid; the sticky sidebar cannot overlap its table. Its five columns
remain available in a horizontally scrollable, keyboard-focusable region on phones.

## Image decisions — still open

- Approved Option A logo is preserved.
- LOLA polar slope image and Marius Hills pit remain pending the owner's review.
- MOLA remains the current Mars production candidate.
- SWIM remains **QA-only** pending the owner's Mars-image choice. It is absent from `site/`. Source maintainers can compare it
  with `npm run build:qa` / `npm run preview:qa`, then `?marsArt=swim` and the Mars target. Do not publish a QA build.

## Verification and remaining limits

The review includes Chromium 156.0.8078.80, Firefox 158.0 and Playwright WebKit 27.2 on Windows. Narrow layouts were tested at
390 and 320 CSS px, along with desktop, breakpoint, landscape and reflow-equivalent sizes. WebKit is not a physical Safari test.
No actual phone, touchscreen/on-screen keyboard, screen reader or neutral human usability session was available.

Automated WCAG A/AA scans found no violations in 45 screen/width/browser cases. This is not a full accessibility certification.
Scientific values, missing reasons and provenance pass independent CSV/profile/GeoJSON checks. The comparison's SHA-256 is
`ca2cccda2fa980af2b76a01ead29b0ea2311be7ecbffc7e7764fe6b458f4e3d6`.

Performance is measured on localhost, including 4× CPU / 1.6 Mbps / 150 ms latency. The uncompressed static server is conservative
for transfer cost. Cold mobile LCP was about 3.5 s in that regime; local interaction latency was much lower than the throttled
case. Slower CPUs still show noticeable initial rendering tasks. These are lab observations, not field Core Web Vitals guarantees.
Enable compression and validate on the team's intended devices before public release.

Before public release: settle image choices; conduct the real-device/assistive-technology and human task checks; decide hosting;
then verify that exact hosted build. No P9 deployment has occurred.

## Source bundle

The separate source ZIP contains the current website source, prepared comparison, credits and review documents. From
`source/website/` (Node 24 tested):

```text
npm ci
npm run build
npm run build:pages
npm run build:qa
npm run check:release
```

`build` is for `/`; `build:pages` uses `/artemis-twin/`. For a different team path, rebuild with the appropriate Vite `--base`.
All primary navigation uses hash routes, so static hosts need no route rewrite. Source inputs for optional image/data
regeneration are documented; the normal frontend build uses the included prepared assets and does not need GIS tooling.

Font OFL notices and the MapLibre notice are in `site/licenses/`. Data/image sources and limitations appear in the site,
the source package and the included review. The original logo's creation history is not known; it is owner-supplied artwork.

## Addendum — provisional screening integration

An additive screening layer was built on top of this candidate without changing the bundle, styles, catalog, comparison
file or release images. It adds an offline Python ETL pipeline, static payloads in `public/data/` (mirrored to
`site/data/`), Analog Fit cards with uncertainty bands and Data Completeness, gap analysis, live NASA POWER/EONET
context, and GIBS/map markers. The original catalog's Fit deliberately remains unset; the added numbers are a separate,
model-dependent exercise and are labelled as such.

See **`SCREENING_INTEGRATION.md`** for run commands, provenance, explicit missing layers/Earth limits, and
`VERIFICATION_SCREENING.json` (600+ checks). The release documents above are unchanged; the original checksum
manifest is preserved as `SHA256_RELEASE_0.8.0-rc.1.json`, and `SHA256.json` covers the extended delivery.

---

Quantitative Earth-to-Moon & Mars analog screening engine. Compares any Earth site against NASA LOLA, Diviner, and MOLA target envelopes across 12 environmental layers using live AWS elevation tiles, NASA POWER climatology, and 4,000-draw Monte Carlo uncertainty modeling.
