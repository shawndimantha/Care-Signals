# Data Card — CPT 72148 (MRI Lumbar Spine w/o Contrast), Outpatient, San Francisco

Generated: 2026-07-18. All rows in `prices_72148.json` trace to a real, fetched source file/page — no rate was estimated or invented. Where a real value could not be located, `rate` is `null` and the gap is documented below.

## Tool note

The task specified running each MRF through the Apify actor `george.the.developer/hospital-mrf-normalizer`. That actor is **not available** in this environment (no Apify tool was accessible). Per the task's own fallback ("filter to code 72148 with code (grep / pandas / the Apify actor)"), MRFs were downloaded with `curl` and filtered locally with Python (`json`/`csv` modules — `pandas` was not installed) so raw multi-hundred-MB files never entered model context. Only the filtered (KB-sized) subsets were read.

## Facilities and price spread

| Facility | Type | Cash/Self-pay | Negotiated range found |
|---|---|---|---|
| UCSF Medical Center (Parnassus) | Academic/large-system — **high anchor (cash)** | $2,217.60 (technical component) + $487.20 (professional component) | $349.03–$698.07 (Medicare Advantage plans only; no commercial Aetna/Cigna found) |
| California Pacific Medical Center – Van Ness Campus (Sutter Health) | Community hospital | $4,851.00 | $2,772–$3,227 (Aetna $2,864, Cigna $2,849, United $2,828, Blue Shield $2,772, Anthem $3,227) |
| Saint Francis Memorial Hospital / "Hyde Hospital" (UCSF Health) | Hospital-affiliated (formerly independent community hospital, now UCSF-owned) | $7,115.00 — **highest cash price found overall** | $517.79–$5,168 (United $517.79, Aetna $2,138.64, Cigna $4,935, BCBS-Anthem $5,168) |
| SimonMed Imaging – San Francisco – Sfmrc | Freestanding imaging center — **low anchor (cash)** | $586.00 (MDsave, observed 2026-07-18) | Not published (see below) |

**Overall cash-price spread: $586.00 (freestanding) → $7,115.00 (Hyde Hospital)**, an ~12.1x gap for the identical CPT code within the same city.

**2026-07-18 update:** the original freestanding low anchor (Diagnostic Imaging Center, $625.00 via radiologyassist.com) was flagged as stale — that page's rate table dates to 2020 — and replaced with a current, live MDsave listing for SimonMed Imaging – San Francisco – Sfmrc (1180 Post St). See `RUN_NOTES.md` for details.

## Where 72148 was absent or incomplete, and what was substituted

- **UCSF Medical Center — commercial payers (Aetna, Cigna) absent.** The HCPCS-level 72148 line in UCSF's MRF lists only 5 payer rows, all tagged `plan_name: "Medicare Managed Care Plan"` (Aspire, Blue Shield, Brown & Toland, Chinese Community Health Plan, Unitedhealthcare). No standard commercial PPO/HMO negotiated dollar amount for 72148 exists anywhere in the 90MB file. Marked `null` in the dataset rather than substituting a different code or estimating. UCSF's cash price is also split across two separate CDM lines (technical vs. professional component) rather than one bundled global cash rate — both are reported.
- **Diagnostic Imaging Center (freestanding) — no MRF at all.** Freestanding, non-hospital-owned imaging centers are not covered by the CMS hospital price-transparency MRF mandate (that rule applies to licensed hospitals), so no machine-readable file exists to fetch. Per the task's fallback instruction, the facility's published self-pay/cash price ($625.00 for "MRI Lumbar Spine w/o contrast") was pulled from its consumer price-lookup page (radiologyassist.com) instead. No negotiated commercial rates are published for this facility; marked `null`.

## Schema quirks handled

1. **UCSF MRF (JSON, CMS v2/v3 format):** single 90MB line with no line breaks — could not `grep` by line number for citation; instead parsed as JSON and cited by `description` + `code_information` + field values, which is the addressable unit in this format.
2. **UCSF split components:** 72148 appears as three separate charge-master line items (`Hc Mri, Spine, Lumbar Wo Contr` / TC modifier; `Pr Mri, Lumbar Spine`; and the bare HCPCS payer-rate line) rather than one row — technical and professional components are billed and cash-discounted separately. Reported both cash figures rather than summing them, since summing would be a derived (not source) number.
3. **Sutter/CPMC CSV (wide CMS v3 format):** standard "tall" CMS CSV with `code|1..4` columns; had to scan all four `code|N` columns per row since 72148 appears in different column positions depending on row (sometimes `code|1`, sometimes `code|3`). Cited by literal CSV row number.
4. **CPMC and Hyde Hospital "discounted_cash" == "gross_charge":** both facilities report identical gross charge and discounted-cash figures for 72148 (e.g., CPMC $4,851/$4,851; Hyde $7,115/$7,115), meaning no actual self-pay discount is applied off the chargemaster rate for this code at either site. Reported as-is; flagged here so it isn't mistaken for a data error.
5. **Sutter page had no directly-crawlable download links** — `curl` to `sutterhealth.org` returned no response in this sandboxed network (likely bot/edge protection); the actual CSV URLs were recovered via `WebFetch` reading the rendered page, then downloaded directly from Sutter's `edge.sitecorecloud.io` CDN, which worked fine with `curl`.
6. **CPMC CSV filename covers two sites** ("Van Ness Campus and Pacific Heights Outpatient Center") — Sutter publishes one combined chargemaster for both; rows aren't distinguishable by sub-location, so all CPMC rows are attributed to "California Pacific Medical Center – Van Ness Campus" as named in the file's own `hospital_name`/`location_name` fields.

## Facilities not used

Dignity Health's former San Francisco hospital (St. Mary's Medical Center) was researched as a possible 4th distinct system but turned out to have been acquired by UCSF Health and renamed "Stanyan Hospital" — effectively the same parent system as Hyde Hospital, so it was not used as a separate independent data point to avoid double-counting the same health system twice.

## Source URLs (for live spot-check in Q&A)

- UCSF Medical Center MRF (Box download): `https://app.box.com/index.php?rm=box_download_shared_file&shared_name=ldckxfm5nm9wah74gqi7fdhe6mrtpg5e&file_id=f_1959275070690`
- CPMC Van Ness Campus standard charges CSV: `https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1740348929_california-pacific-medical-center-van-ness-campus_standardcharges.csv`
- Saint Francis Memorial Hospital / Hyde Hospital MRF (Box download): `https://app.box.com/index.php?rm=box_download_shared_file&shared_name=8wogrqzbbev45c7pup8v9298ul2ymlpr&file_id=f_1732346032300`
- SimonMed Imaging – San Francisco – Sfmrc, MDsave product page (current, replaces the stale 2020 radiologyassist.com listing): `https://www.mdsave.com/p/simonmed-imaging-san-francisco-sfmrc-imaging-and-radiology/mri-without-contrast/d584ffce63dc`

## Local files written

- `prices_72148.json` — 18 rows, schema `{facility, facility_type, payer, plan, rate, rate_type, cpt, source_url, source_line_or_field, facility_address, distance_from_patient}`. The last two fields were added 2026-07-18: `facility_address` is the real street address pulled from each facility's own MRF/source page (already cited via `source_url`); `distance_from_patient` is a hand-estimated, rounded, explicitly-"(approx.)" driving distance/time from a synthetic demo patient's home address — not from a mapping API. See `RUN_NOTES.md` for the estimation method.
- `data_card.md` — this file

Both saved under: `/private/tmp/claude-501/-Users-shawndimantha-claudeprojects-agentic-health-hack/3a17db48-d678-4a91-a09c-74ecd3dc6e5f/scratchpad/mrf/`
