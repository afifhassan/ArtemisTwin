# ArtemisTwin P7/P8 — team review candidate 0.8.0-rc.1

Work began 9 November; handoff completed 10 November 2026 (Asia/Qatar). **P7 layout passes. P8 technical checks pass; the candidate is ready for team review, with public-release decisions still open. No P9 publication occurred.** The owner transferred website writing to Codex, then specified file delivery to the team with no Git initialization or push. Claude's existing P7 source was retained.

## Portfolio overlap — reproduced and corrected

An empty portfolio reproduced the reported failure: the sticky add-sites sidebar painted over Laboratory Context's heading and last columns. Populated portfolios also failed at 1440 and 1101 px. The table was a final row in the same grid containing the sticky sidebar, so that grid did not bound the sidebar above the table.

`src/modules/portfolio.js` now places Laboratory Context outside `.pf-layout`, as a full-width sibling inside the evidence panel. `src/styles/refine.css` bounds the sticky sidebar to the upper grid and removes the laboratory row from both desktop and stacked grid definitions.

**Final verification: ten cases pass**, empty / Mauna Ulu + Atacama at 1440, 1101, 1100, 390 and 320 px. Both scrolling and keyboard activation of Laboratory context were tested. The sidebar clears the table, all five columns remain reachable, sources are retained, and jump focus reaches `#pfLim` with a visible outline. On phones the table scrolls within a labelled, keyboard-focusable region. Geometry checks allow normal subpixel rounding.

Corrected captures: [empty desktop](portfolio-scroll-1440-empty.png), [populated desktop, keyboard jump](portfolio-jump-1440-added.png). Original captures are in `portfolio-before/`. Reproduction: `portfolio-layout.js`; results: `portfolio-layout-before.json`, `portfolio-layout-frozen.json`.

## P7 independent result

At 1440, 390 and 320 px:

- Purpose arrows change the selection and preserve focus. The phone picker precedes imagery; its CTA begins in normal flow and stays pinned above the disclaimer after reaching the picker. Desktop CTA remains available.
- Opening Site Detail omits CRS/bounds text; Coordinates and reference systems in Detailed evidence contains both systems, bounds and transform.
- Edit portfolio focuses Your portfolio. The selection set survives the journey.
- Desktop transects are paired side by side on shared axes; phone charts stack, with the legend above and compact distance/step controls. Values agree with the source.
- A cold start deliberately held the MapLibre import. Match Map opened while the library was still pending, the list remained usable, and release of the request produced the correctly framed map. No uncaught error.
- `?marsArt=swim` displays the actual SWIM derivative in QA; the same query in production still displays MOLA. Production assets and references contain no SWIM preview. The release guard now explicitly rejects its leakage.

Evidence: `p7-final.json`, screenshots `p7-*`. **This is a layout/behavior result, not image approval.** LOLA and Marius Hills remain pending owner review; MOLA remains the current provisional Mars image; SWIM stays QA-only until selection. See `source-audit.md` for independently reopened primary sources and approvals.

## P8 fixes and acceptance evidence

Additional fixes: valid radio-group list semantics; valid definition-list summaries; labelled focusable table scroll regions; sufficient About hit area; an underline on basemap credit links; higher-contrast blue focus on dark panels; explicit failed context imagery retaining its caption/source; visible WebGL context-loss feedback and restoration. The empty portfolio now consistently reports one Earth exclusion and eleven remaining unknown/needed conditions in both tiles and summary. Pressure is a body-level exclusion, not an invented measurement. The old unsupported banner's overbroad match sentence is corrected. AI-use credits now include Codex's takeover and P8 work. Full MapLibre redistribution notices join both OFL notices.

The renderer groups slope cells by their existing display colour instead of styling each rectangle separately. It adds no measurements or interpolation. **All 1,000 cell centres** across two studies and two scales were checked against source values/colours and geometry; no difference. At 100 m it reduces cell drawing nodes from 800 rectangles to 385 paths. This demonstrates a DOM reduction; it does not establish a controlled latency improvement.

`summary.json` / `summarize.py`: **102/102 acceptance checks pass**. Evidence includes:

- Nine browser/width journeys through target/purpose, map, detail, sources/dialogs, portfolio, profiles, refresh and history. Twelve target × purpose selections preserve the supported/site-only distinction, unknowns and unset Fit.
- **Seven fresh exports from the frozen root release**, parsed independently: three measurement CSVs, two profile CSVs, two GeoJSONs. `csv-verification.json`: **74/74**; `spatial-export-verification.json`: **145/145**. Values, units, scales/support, source/date/method provenance, named missing reasons, pressure exclusions, 126 profile samples, verified Earth geometry and absent unsupported lunar geometry agree with the prepared package. Fit/similarity/ranking remain unset. Downloads are in `downloads/`.
- Root and `/artemis-twin/` paths work. Invalid ids are repaired with notice; legacy `#site=` restores the intended map entry. Registry separates observation/publication/retrieval/processing and names the August 2004 basemap. Rendered AI-use includes the actual study-boundary and website roles (`records.txt`).
- Catalog failure has stable Retry/Continue states; delayed fonts time out to usable fallback; logo failure uses text; failed context art is explicit. Comparison Retry recovers. A delayed Moon response cannot overwrite the newer Mars / Ice Detection selection. Empty, absent and short profile series leave the other direction usable.
- **Twelve dialog cases**: both dialogs × Close/Escape × all three widths. After a background render disconnects each original opener, focus returns to the visible equivalent. `dialogs.json` waits for the queued close event; the earlier immediate snapshots in `recovery-final.json` precede that event and are not focus-return verdicts.
- No WebGL leaves a usable list. Actual `WEBGL_lose_context` loss shows a notice; restoration returns rendering. Failed NASA tiles show a fallback banner while the verified marker/list remain. Loaded evidence still responds without network; this is not full offline support. No-JS and absent animation API have usable explanatory/static outcomes.
- Thirty-five additional screen/layout cases cover intermediate widths, landscape and reflow-equivalent viewports; no page-wide overflow. Five reduced-motion route cases have no running animations; resize preserves inspected distance. Rapid navigation settles correctly. The CDP background-visibility override was unsupported, so real background/resume is not independently certified.

## Browsers, accessibility and limits

Windows desktop runtimes actually exercised: **Chromium 156.0.8078.80, Firefox 158.0, Playwright WebKit 27.2**. Final axe-core 4.11.0 WCAG A/AA audits cover all five screens at 1440/390/320 in all three engines: **45 cases, zero automated violations and zero uncaught page errors**. Screenshots were rendered and representative desktop/mobile results inspected. Initial headed WebKit captures were black; those contrast results were discarded and replaced with successful headless WebKit rendered audits.

These are desktop engines with narrow CSS viewports, not physical phones or actual Safari devices. WebKit's default Tab behavior skipped links in this runtime; its functional journey used explicit anchor focus plus Enter, while Chromium/Firefox reached the CTA through Tab. No screen reader, real touchscreen/on-screen keyboard, native-browser zoom certification or neutral human usability session was available. Narrow reflow equivalents are recorded as such. Automated audits are not full WCAG certification.

## Production performance observations

Chromium localhost, 390 px. Local cold n=1; slow cold n=3; slow warm n=3. Slow regime: **4× CPU, 150 ms latency, 1.6 Mbps down**. Server transfers are uncompressed; enable host compression and retest on intended hardware. The identity gate begins after script startup and is not total navigation time.

| Regime | Median identity gate | Median navigation LCP | Max initial CLS | Max observed interaction |
| --- | ---: | ---: | ---: | ---: |
| Local cold | 98 ms | 320 ms | 0 | 152 ms |
| Slow cold | 878 ms | 3536 ms | 0 | 760 ms |
| Slow warm | 613 ms | 724 ms | 0 | 976 ms |

`performance-after.json` contains raw resources, event timings, long tasks and frame samples. These are laboratory observations, not field INP or Core Web Vitals guarantees. Slower CPUs retain noticeable first-render work; no reliable latency improvement is claimed from the drawing change. Frame scheduling in this automation environment can be withheld until capture, so frame samples do not certify smoothness. This performance caveat stays visible for team evaluation before public release.

Main JS is approximately 116 kB raw / 38 kB gzip; CSS 53 / 11 kB; Latin fonts total 65.6 kB. Deferred MapLibre JS is 1.11 MB raw / 294 kB gzip, plus a 520 kB worker. Optional map costs never gate catalog readiness. No backend, analytics or live AI service was added.

## Candidate and remaining decisions

Both production builds pass the release guard: **256 files, 13,600 KiB, release clean**. QA is rejected (15 findings); independent missing-build and deliberately leaked SWIM fixtures are also rejected. Prepared/public/root/base-path comparison hash remains `ca2cccda2fa980af2b76a01ead29b0ea2311be7ecbffc7e7764fe6b458f4e3d6`. Approved brand files remain unchanged from takeover. Source changes and evidence hashes are recorded without creating Git.

Deliver `ArtemisTwin_0.8.0-rc.1_frontend.zip` and the separate source ZIP from `output/`. The unpacked frontend contains `site/`, `serve.py`, README and team-review instructions. Production files exclude QA/SWIM; source includes QA for development only. The owner's latest destination is **file handoff to the team**, not a hosted URL. No provider/domain/account has been invented, initialized or published.

P8 engineering evidence is complete for this candidate's tested scope. Public-release acceptance remains conditional on owner image decisions, neutral human usability review, intended real-device/assistive-technology/performance checks, team hosting choice and a hosted smoke test. `TEAM_REVIEW.md` provides that bounded review task. Do not label those open items as passed or P9 complete.

The assembled frontend was also served through its included `serve.py` on port 8420 and exercised from entry → map → Mauna Ulu → Site Detail. The packaged root build reports the selected scope, 3/12 site and comparable coverage, and Fit Not set (`packaged-smoke.txt`). ZIP CRCs, production-byte identity, absence of QA/SWIM paths and comparison integrity pass; source QA is retained separately. Final archive sizes and SHA-256 values are in `package-verification.json` outside the archives.
