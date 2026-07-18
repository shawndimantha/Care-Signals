#!/usr/bin/env node
"use strict";

/*
 * Pricing/OOP agent for the CPT 72148 demo.
 * Run with: node agent.js
 *
 * Reads demo_encounter.json + prices_72148.json + oop_scenarios.json,
 * executes 5 visible steps (each prints a one-line status), and writes
 * agent_output.js -- a plain `const FACILITIES = [...]` file that
 * options_card.html loads via <script src="agent_output.js">.
 *
 * No dependencies, no build step. Node's built-in fs/path only.
 */

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const fmt = (n) =>
  n == null
    ? "not published"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(n * 100) / 100;
const baseName = (name) => name.split(" (")[0].trim();

function log(step, msg) {
  console.log(`[${step}/5] ${msg}`);
}

// ---------------------------------------------------------------------------
// STEP 1: Parse the signed order text into a CPT code.
// A real system would use an NLP/coding model here; this demo uses a small
// keyword table so the mapping stays auditable and never guesses silently.
// ---------------------------------------------------------------------------
const CPT_TABLE = [
  {
    cpt: "72148",
    requiredKeywords: ["lumbar", "spine", "without contrast"],
    description: "MRI lumbar spine without contrast",
  },
];

function parseOrderToCPT(orderText) {
  const lower = orderText.toLowerCase();
  for (const entry of CPT_TABLE) {
    if (entry.requiredKeywords.every((k) => lower.includes(k))) {
      return entry;
    }
  }
  return null;
}

function step1(encounter) {
  const orderText = encounter.signed_order.order_text;
  const match = parseOrderToCPT(orderText);
  if (!match) {
    log(1, `Parsed signed order "${orderText}" -> NO CPT MATCH (unrecognized order text; refusing to guess)`);
    return null;
  }
  log(1, `Parsed signed order "${orderText}" -> CPT ${match.cpt} (${match.description})`);
  return match.cpt;
}

// ---------------------------------------------------------------------------
// STEP 2: Match the patient's plan (Cigna PPO) against rate rows in the
// price cache for this CPT code, across every facility on file.
// ---------------------------------------------------------------------------
function step2(prices, cpt, payer) {
  const rows = prices.filter((r) => r.cpt === cpt);
  const byFacility = new Map();
  for (const row of rows) {
    const key = baseName(row.facility);
    if (!byFacility.has(key)) {
      byFacility.set(key, {
        facility: key,
        facility_type: row.facility_type,
        facility_address: row.facility_address || null,
        distance_from_patient: row.distance_from_patient || null,
        rows: [],
      });
    }
    byFacility.get(key).rows.push(row);
  }

  let cignaHits = 0;
  for (const entry of byFacility.values()) {
    const cignaRow = entry.rows.find(
      (r) => r.rate_type === "negotiated" && r.payer && r.payer.toLowerCase().includes(payer.toLowerCase()) && r.rate != null
    );
    if (cignaRow) cignaHits++;
    entry.cignaRow = cignaRow || null;
    entry.cashRows = entry.rows.filter((r) => r.rate_type === "cash" && r.rate != null);
  }

  log(
    2,
    `Matched ${payer} plan against ${rows.length} rate rows for CPT ${cpt} across ${byFacility.size} facilities ` +
      `(${cignaHits} with a direct ${payer} negotiated rate, ${byFacility.size - cignaHits} falling back to cash/none)`
  );
  return byFacility;
}

// ---------------------------------------------------------------------------
// STEP 3: Rank facilities by patient out-of-pocket using the cached
// oop_scenarios.json (previously computed and stored alongside the prices).
// ---------------------------------------------------------------------------
function step3(oopScenarios) {
  const ranked = [...oopScenarios.facilities].sort((a, b) => {
    const av = a.patient_out_of_pocket == null ? Infinity : a.patient_out_of_pocket;
    const bv = b.patient_out_of_pocket == null ? Infinity : b.patient_out_of_pocket;
    return av - bv;
  });
  const summary = ranked
    .map((f, i) => `${i + 1}) ${baseName(f.facility)} ${fmt(f.patient_out_of_pocket)}`)
    .join("  ");
  log(3, `Ranked facilities by cached patient OOP -> ${summary}`);
  return ranked;
}

// ---------------------------------------------------------------------------
// STEP 4: Independently recompute OOP (deductible portion + coinsurance
// portion) straight from the price rows + patient plan, and cross-check it
// against the cached ranking from step 3. This is the "show the math live"
// step for the demo.
// ---------------------------------------------------------------------------
function computeOOP(rateUsed, deductibleRemaining, coinsuranceRate) {
  if (rateUsed == null) {
    return { deductible_portion: null, coinsurance_portion: null, oop: null };
  }
  const deductible_portion = round2(Math.min(rateUsed, deductibleRemaining));
  const balance = round2(Math.max(0, rateUsed - deductibleRemaining));
  const coinsurance_portion = round2(balance * coinsuranceRate);
  const oop = round2(deductible_portion + coinsurance_portion);
  return { deductible_portion, coinsurance_portion, oop };
}

function step4(byFacility, patientPlan, cachedRanked) {
  const deductibleRemaining = patientPlan.deductible_total - patientPlan.deductible_met;
  const coinsuranceRate = patientPlan.coinsurance_rate_after_deductible;
  const cachedByName = new Map(cachedRanked.map((f) => [baseName(f.facility), f]));

  const results = [];
  for (const entry of byFacility.values()) {
    let rateUsed = null;
    let rateType = "none";
    let payerLabel = "not published";

    if (entry.cignaRow) {
      rateUsed = entry.cignaRow.rate;
      rateType = "negotiated";
      payerLabel = `Cigna (${entry.cignaRow.plan || "plan not specified"}), negotiated ${fmt(rateUsed)}`;
    } else if (entry.cashRows.length > 0) {
      rateUsed = round2(entry.cashRows.reduce((sum, r) => sum + r.rate, 0));
      rateType = "cash";
      payerLabel =
        entry.cashRows.length > 1
          ? `Cash / self-pay, no Cigna contract found (sum of ${entry.cashRows.length} chargemaster components)`
          : "Cash / self-pay, no Cigna contract found";
    }

    const computed = computeOOP(rateUsed, deductibleRemaining, coinsuranceRate);
    const cached = cachedByName.get(entry.facility);
    const cachedOOP = cached ? cached.patient_out_of_pocket : null;
    const matches =
      rateUsed == null ? cachedOOP == null : cachedOOP != null && Math.abs(cachedOOP - computed.oop) < 0.01;

    if (rateUsed == null) {
      log(4, `Computed OOP for ${entry.facility}: NOT PUBLISHED (no Cigna rate, no cash price found) -- rendering "not published", not a guess`);
    } else {
      log(
        4,
        `Computed OOP for ${entry.facility}: deductible ${fmt(computed.deductible_portion)} + coinsurance ${fmt(
          computed.coinsurance_portion
        )} = ${fmt(computed.oop)} (matches cached oop_scenarios.json: ${matches ? "yes" : "NO -- MISMATCH"})`
      );
    }

    results.push({
      facility: entry.facility,
      facility_type: entry.facility_type,
      facility_address: entry.facility_address,
      distance_from_patient: entry.distance_from_patient,
      rate_used: rateUsed,
      rate_type: rateType,
      payer_label: payerLabel,
      deductible_portion: computed.deductible_portion,
      coinsurance_portion: computed.coinsurance_portion,
      oop: computed.oop,
      _sourceRows: entry.cignaRow ? [entry.cignaRow] : entry.cashRows,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// STEP 5: Attach a source citation to every dollar figure. If a facility has
// no rate at all, it gets no citation and is marked "not published" -- never
// blank, never estimated.
// ---------------------------------------------------------------------------
function step5(results) {
  for (const r of results) {
    if (!r._sourceRows || r._sourceRows.length === 0) {
      r.source_url = null;
      r.source_label = "not published";
      log(5, `${r.facility}: no rate on file -> no citation attached, rendering "not published"`);
      continue;
    }
    if (r._sourceRows.length === 1) {
      const row = r._sourceRows[0];
      r.source_url = row.source_url;
      r.source_label = row.source_line_or_field.length > 90 ? row.source_line_or_field.slice(0, 87) + "..." : row.source_line_or_field;
    } else {
      // multiple cash components summed (e.g. UCSF technical + professional)
      r.source_url = r._sourceRows[0].source_url;
      r.source_label = r._sourceRows
        .map((row) => `${row.payer || "cash"} ${fmt(row.rate)}`)
        .join(" + ") + " (summed from " + r._sourceRows.length + " source rows)";
    }
    log(5, `${r.facility}: attached citation -> ${r.source_url}`);
    delete r._sourceRows;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const encounter = read("demo_encounter.json");
  const prices = read("prices_72148.json");
  const oopScenarios = read("oop_scenarios.json");

  console.log(`--- Agent run for patient ${encounter.patient.name} (${encounter.patient.age}${encounter.patient.sex}), ${encounter.patient.insurance.payer} ${encounter.patient.insurance.plan} ---`);

  const cpt = step1(encounter);
  if (!cpt) {
    console.error("Stopping: could not resolve a CPT code from the signed order. No output written.");
    process.exit(1);
  }

  const payer = encounter.patient.insurance.payer;
  const byFacility = step2(prices, cpt, payer);
  const cachedRanked = step3(oopScenarios);
  const results = step4(byFacility, encounter.patient.insurance, cachedRanked);
  const withCitations = step5(results);

  const banner =
    `// AUTO-GENERATED by agent.js -- do not hand-edit.\n` +
    `// Regenerate with: node agent.js\n`;

  fs.writeFileSync(
    path.join(DIR, "agent_output.js"),
    banner + `const FACILITIES = ${JSON.stringify(withCitations, null, 2)};\n`
  );

  // Also republish the encounter fixture as a script-loadable global so
  // options_card.html can render the encounter panel purely via <script src>
  // tags -- no fetch() needed, so it works unmodified when opened via file://.
  fs.writeFileSync(
    path.join(DIR, "encounter_output.js"),
    banner + `const ENCOUNTER = ${JSON.stringify(encounter, null, 2)};\n`
  );

  console.log(`\nWrote ${withCitations.length} facilities to agent_output.js and the encounter fixture to encounter_output.js. Open options_card.html in a browser to view.`);
}

main();
