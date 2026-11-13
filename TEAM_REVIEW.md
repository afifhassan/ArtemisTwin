# Remaining team/owner decisions

No publication is requested or authorized. These checks distinguish a tested frontend candidate from a public release.

1. **Images:** owner reviews LOLA and Marius Hills; chooses MOLA or SWIM for Mars. Keep SWIM in QA until that choice.
2. **Neutral task review:** ask a likely visitor to choose a testing target/purpose, investigate an Earth candidate, compare
   terrain, keep a portfolio and export the evidence. Avoid coaching. Ask the visitor to explain the choice and one limitation.
   Record completion/time, confusion, failed actions, device/browser and any consequential misunderstanding. Not yet conducted.
3. **Real devices:** test the actual team's phone/browser, zoom, touch, orientation and on-screen keyboard. Use a screen reader
   for the task and dialogs. The current evidence covers desktop engines and narrow viewports, not physical-device certification.
4. **Performance:** repeat on intended hardware/network; inspect the first map/detail render. The candidate records slower
   interactions under 4× CPU throttling. No field INP/LCP claim is made.
5. **Hosting:** team chooses provider/domain/base path and access policy. Rebuild for that base path and test clean direct links,
   reload, sources, icons, workers and exports on the actual host. Preserve this candidate for rollback.

For a Mars-image change, regenerate the selected approved derivatives, update source/asset approval records, remove the QA-only
restriction only for that approved image, rebuild and rerun the release guard and browser/source checks. Never ship `dist-qa`.
