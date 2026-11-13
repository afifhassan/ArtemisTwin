# P8 source, identity and approval audit

The prepared comparison remains the original Codex source package, method `bounded-terrain-1.0`, SHA-256 `ca2cccda2fa980af2b76a01ead29b0ea2311be7ecbffc7e7764fe6b458f4e3d6`. P8 changes its display, not its measurements or analysis boundaries. Measurements, profile samples and GeoJSON exports are independently checked in `csv-verification.json` and `spatial-export-verification.json`.

## Image decisions are separate from layout results

| Image | Candidate state | Production / QA |
| --- | --- | --- |
| Approved Option A logo | Fixed, approved; emblem/lettering/colour/proportions preserved | Existing derived logo layers/icons, unchanged by P8 |
| LOLA polar slope context image | Pending owner's review | Existing P7 production candidate, captioned Context image |
| Marius Hills pit | Pending owner's review; possible skylight, not a study window | Existing P7 production candidate, explicitly Provisional preview |
| MOLA PIA02993 northern hemisphere | Current Mars image, still provisional pending owner's choice | Production candidate |
| SWIM PIA26045 | Preview pending owner's Mars-image selection | QA only, `?marsArt=swim`; excluded from both production builds and production ZIP |

Primary pages independently reopened on 9 November 2026:

- [LOLA slope image](https://science.nasa.gov/image-detail/slope-75s-large-2/): source describes LOLA slope/elevation context and a 2123 × 2202 image. The displayed regional image is distinct from the 2 × 2 km computed window beside it. The page update is a publication/web metadata date, not the acquisition date of the comparison DEM.
- [Marius Hills pit](https://lroc.im-ldi.com/images/202): the enlargement caption gives 480 m image width, NAC M114328462R and NASA/GSFC/Arizona State University credit. The application retains the possible-skylight qualification and does not use it as the undefined Lava-Tube Region's measured footprint.
- [MOLA PIA02993](https://science.nasa.gov/photojournal/mars-orbiter-laser-altimiter-mola-globe/): NASA/JPL/USGS; the globe base is approximately 1850 m/pixel and the northern hemisphere is the left map. The application marks it as context, without a selected site.
- [SWIM PIA26045](https://science.nasa.gov/photojournal/swim-map-shows-subsurface-water-ice-on-mars/): NASA/JPL-Caltech/Planetary Science Institute, added 26 October 2023. The caption supports the blue ice areas, mission triangles and impact-crater circles. The application does not invent meanings for the two circle colours. This audit does not approve its adoption.

Originals and derivatives retain their existing provenance in `artemis-twin-p0/ASSET_MANIFEST.json` and the P7 source records. No image was generated or recoloured. Failed context art now retains its source caption and shows an unavailable state.

## Data and limitations

Only Moon South-Pole Ridge / Rover Mobility has a prepared target/Earth comparison. Site-only Earth data for unsupported selections remains distinct from target data; other nine study conditions remain scientifically unknown. Pressure can separately be physically excluded from Earth matching without becoming an elevation-study measurement. Empty portfolio overview/summary now consistently show one Earth exclusion and eleven remaining unknown/needed conditions; previously the P7 tiles and summary contradicted each other. Fit, similarity and ranking remain unset/unassessed.

The Registry distinguishes source observations, source publication, retrieval and deterministic processing. The AI-use record now credits Codex's website takeover and P8 fixes, in addition to selecting and preparing the original analysis windows. No live AI service is called.

## Fonts and branding

Both OFL licences are shipped. Big Shoulders uses the corrected upstream Project Authors credit; Instrument Sans retains its packaged Project Authors credit. No new font or runtime animation dependency was added. Approved brand files are checked against the takeover manifest; no logo geometry or Earth/Mars colour change was made.

## Team delivery

The owner's latest instruction is to send frontend files to the team, with no Git initialization, push or hosting publication. No Git repository was created. The team's eventual hosting domain/provider/path is intentionally not fabricated. Deliver a root-path static candidate, the source and a documented base-path build option. Hosting, physical-device checks, a neutral human usability run and final target-image selection remain team/owner decisions before a public release.
