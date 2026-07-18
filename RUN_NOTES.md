# Run Notes — 2026-07-18, fourth pass (patient context, distance, confirm + calendar artifact)

## What changed

**STEP 2 — Patient sidebar.** `demo_encounter.json`'s `patient` object now has a real-shaped `address` (`1450 Sutter St, Apt 4, San Francisco, CA 94109` — a plausible Polk Gulch/Van Ness-corridor address, invented for the demo, not tied to any real person) and a `555` phone number (`(555) 014-2938`, the standard fictional-number prefix). The name is now "Jane Whitfield" instead of the placeholder-looking "Jane Demo-Patient." The clinician's display name dropped the `(synthetic)` suffix (`Dr. A. Rivera, MD`) per instruction — the top-level `_disclaimer` field and the page footer are untouched, so the synthetic-data labeling is still intact elsewhere.

`options_card.html` gained a new `.patient-sidebar` panel, rendered above the encounter panel (so it's visible before the "Check patient cost" click and before any price data shows): name, age/sex, MRN, address, phone, payer+plan, and `"$0.00 of $3,000.00 met"` — all pulled from `ENCOUNTER`, nothing hardcoded. The page subtitle line (previously a static "$3,000 deductible ($0 met)" string) is now also generated from the same data, and the deductible/coinsurance arithmetic in the cards now reads the deductible total from `ENCOUNTER` instead of a hardcoded `3000` — both were latent hardcodes from earlier passes, fixed while touching this area.

**STEP 3 — Distance from the patient.** Added `facility_address` and `distance_from_patient` to every row in `prices_72148.json`. Addresses are real, pulled straight from the same source files already cited in each row (`hospital_address` field in the UCSF and Hyde Hospital MRFs, the `hospital_address` column in the CPMC CSV, and the address already embedded in the SimonMed facility name from the MDsave page):
  - UCSF Medical Center (Parnassus): 505 Parnassus Ave, San Francisco, CA 94143
  - California Pacific Medical Center – Van Ness: 1101 Van Ness Ave, San Francisco, CA 94109
  - Saint Francis Memorial Hospital (Hyde Hospital): 900 Hyde St, San Francisco, CA 94109
  - SimonMed Imaging – San Francisco – Sfmrc: 1180 Post St, San Francisco, CA 94109

Distances/times are **hand-estimated from known San Francisco street geography** (Polk Gulch/Van Ness corridor as the reference point) — I did not call a mapping API. Every value is rounded and explicitly suffixed `(approx.)`: SimonMed ~0.4 mi/~3 min, CPMC ~0.3 mi/~3 min, Hyde ~0.6 mi/~4 min, UCSF Parnassus ~3.8 mi/~15 min (across town, near Golden Gate Park). These are directionally correct given the real addresses but should be treated as rough estimates, not turn-by-turn numbers — flagging this so nobody in Q&A mistakes them for a live routing API result.

`agent.js` now carries `facility_address`/`distance_from_patient` through from `prices_72148.json` into `agent_output.js` per facility (added to the grouping step and the final result objects — no new pipeline step, just two more fields riding along the existing ones). `options_card.html` renders the distance as a small "📍" line under the facility name/type on each card, sort order unchanged (still ascending by patient OOP), and the recommended (cheapest) facility's distance is included in the mock SMS text.

**STEP 4 — Confirm + calendar artifact.** After the existing SMS beat, a new **"Confirm SimonMed and schedule"** button:
  1. Disables itself and turns the SMS bubble into a pending state: *"Calling SimonMed to schedule… (stub — no real call is being placed)"* — labeled explicitly as a stub under the button too ("Stubbed handoff for this demo... Real scheduling call/API is next-build scope."). No telephony of any kind is implemented.
  2. After ~1.4s, resolves to a confirmation message with a concrete synthetic appointment slot (Wednesday, July 22, 2026, 9:30–10:00 AM, at whichever facility is currently ranked cheapest, with its address and price — all read live from `FACILITIES`, not typed in).
  3. Shows "Reminder queued for 24 hours before."
  4. Builds a real `.ics` file client-side (`Blob` + `URL.createObjectURL`, no server) and points a download link at it.

The appointment date/time itself is a fixed synthetic slot (not derived from any real scheduler) so the `.ics` is reproducible; every other field in it (facility name, address, price, CPT code) comes from the agent's live data.

## Verification

Same method as the prior pass — real Chromium via Playwright (`~/Library/Caches/ms-playwright/chromium-1208`), not a stubbed DOM, loaded via an actual `file://` URL:
- Sidebar renders correctly before any click, with the new address/phone/deductible fields.
- All 4 cards show a distance line; sort order confirmed still ascending by OOP (SimonMed → UCSF → CPMC → Hyde).
- SMS text includes the distance suffix on the recommended facility.
- Clicked "Confirm SimonMed and schedule": confirmed the button disables, the pending stub text appears, then after the delay the confirmation text, reminder line, and `.ics` download link all appear with the right data.
- Fetched the actual blob URL contents from the page and saved the `.ics` to disk, then **parsed it with the Python `icalendar` library** (installed for this check) — it parsed cleanly: valid `VCALENDAR`/`VEVENT`, correct `DTSTART`/`DTEND` in UTC (16:30–17:00Z = 9:30–10:00 AM PDT), `UID`, `SUMMARY`, `LOCATION`, `DESCRIPTION`, and a working `VALARM` with a `-P1D` trigger. Verified CRLF line endings throughout (RFC 5545 requires CRLF, not bare `\n`) and that comma/semicolon-bearing fields (`LOCATION`, `DESCRIPTION`) round-trip correctly through the escaping.
- Zero browser console or page errors across the whole run.
- Full-page screenshot reviewed visually — no layout shift; the pre-existing "Check patient cost" and "Send options to patient" buttons are still exactly where they were, nothing new sits on top of them.

## Did not touch

The `.card`, `.delta-banner`, `.oop`, `.row2`, `.rate-info`, `.arithmetic`, `.transcript`/`.turn`, and `.sms-bubble`/`.phone` CSS and markup are unchanged except for the two additive lines specified (`.facility-distance` under the facility name, and the new confirm/reminder/`.ics` elements appended after the existing SMS bubble/voice button — nothing removed or restyled).

## To check

- The distances are estimates, not from a mapping API — good enough for a demo narrative ("everything's within a few blocks except UCSF") but say so up front if asked how precise they are.
- The appointment slot (July 22, 2026, 9:30 AM) is fixed/synthetic and does not change if the recommended facility changes on a future data refresh — only the facility name/address/price in the confirmation text and `.ics` update dynamically. If you want the slot itself to vary, that's a follow-up.
- This pass is **not yet committed to git** (the repo from the last session, `shawndimantha/Care-Signals`, exists but the working tree now has uncommitted changes) — say the word if you want it committed and pushed.
