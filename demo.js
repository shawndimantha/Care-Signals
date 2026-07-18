// Shared helpers for the two-page demo flow (encounter.html + navigation.html).
// Loaded AFTER agent_output.js, encounter_output.js, and sms-text.js.
// Pure/logic only -- no page-specific DOM wiring lives here, so both pages
// compute every dollar figure identically. Nothing here recomputes prices;
// it only formats values already produced by agent.js.

if (typeof FACILITIES === 'undefined' || typeof ENCOUNTER === 'undefined') {
  document.write('<p style="color:#b91c1c;font-family:sans-serif;padding:24px;">' +
    'agent_output.js / encounter_output.js not found. Run <code>node agent.js</code> first, then reload this page.</p>');
  throw new Error('FACILITIES/ENCOUNTER not loaded -- run node agent.js first');
}

const fmt = (n) => (n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));

// Named getSortedFacilities so it doesn't shadow sms-text.js's sortedFacilities(FACILITIES),
// which server.js also relies on.
function getSortedFacilities() {
  return sortedFacilities(FACILITIES);
}

function recommendedFacility() {
  return getSortedFacilities().filter((f) => f.oop != null)[0];
}

// Cash payers bypass insurance math -- only negotiated rows get the breakdown.
function detailLine(f) {
  if (f.rate_used == null) return null;
  if (f.rate_type === 'cash') {
    return `${fmt(f.rate_used)} — cash price, paid directly`;
  }
  const remaining = ENCOUNTER.patient.insurance.deductible_total - ENCOUNTER.patient.insurance.deductible_met;
  const ded = f.deductible_portion;
  const balance = Math.max(0, f.rate_used - remaining);
  return `Deductible portion: min(${fmt(f.rate_used)}, ${fmt(remaining)}) = ${fmt(ded)}  ·  `
       + `Coinsurance portion: ${fmt(balance)} × 20% = ${fmt(f.coinsurance_portion)}  ·  `
       + `Total OOP: ${fmt(ded)} + ${fmt(f.coinsurance_portion)} = ${fmt(f.oop)}`;
}

// The EXACT card markup from the v1 options card -- factored so navigation.html
// can append cards one at a time as prices resolve, unchanged in appearance.
function cardHTML(f, isBest) {
  const rateBadgeClass = f.rate_used == null ? 'na' : (f.rate_type === 'cash' ? 'cash' : '');
  const rateBadgeText = f.rate_used == null ? 'N/A' : (f.rate_type === 'cash' ? 'Cash' : 'Cigna Negotiated');
  const rateDisplay = f.rate_used == null
    ? '<span class="not-published">not published</span>'
    : fmt(f.rate_used);
  const oopDisplay = f.oop == null
    ? '<span class="not-published">not published</span>'
    : fmt(f.oop);
  const detail = detailLine(f);
  return `
    <div class="card ${isBest ? 'best' : ''}">
      ${isBest ? '<div class="rank-badge">LOWEST OUT-OF-POCKET</div>' : ''}
      <div class="facility-name">${f.facility}</div>
      <div class="facility-type">${f.facility_type}</div>
      ${f.distance_from_patient ? `<div class="facility-distance"><span class="pin">📍</span>${f.distance_from_patient}</div>` : ''}
      <div class="oop">
        <span class="oop-label">Patient out-of-pocket</span>
        ${oopDisplay}
      </div>
      <div class="row2">
        <div class="rate-info">
          <span class="badge ${rateBadgeClass}">${rateBadgeText}</span>
          Billed rate: ${rateDisplay}
        </div>
        <div class="source-link">
          ${f.source_url ? `<a href="${f.source_url}" target="_blank" rel="noopener">${f.source_label || 'source'} ↗</a>` : '<span class="not-published">no source</span>'}
        </div>
      </div>
      <div class="payer-label">${f.payer_label || ''}</div>
      ${detail ? `<div class="arithmetic">${detail}</div>` : ''}
    </div>
  `;
}

// ---------------- encounter note helpers ----------------
function clinicianFullName() {
  return ENCOUNTER.signed_order.ordering_clinician.split(',')[0].trim(); // "Dr. A. Rivera"
}
function signedDateTimeDisplay() {
  const m = ENCOUNTER.signed_order.signed_datetime_synthetic.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : ENCOUNTER.signed_order.signed_datetime_synthetic;
}

// ---------------- .ics artifact (UNCHANGED logic; reminder is -P3D) ----------------
const APPOINTMENT = {
  dateDisplay: 'Wednesday, July 22, 2026',
  timeDisplay: '9:30 AM – 10:00 AM',
  dtStartUTC: '20260722T163000Z', // 9:30 AM PDT
  dtEndUTC: '20260722T170000Z',
};
function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
function buildICS(facility) {
  const uid = `care-signals-${Date.now()}@demo.local`;
  const dtStamp = APPOINTMENT.dtStartUTC;
  const priceLine = facility.rate_type === 'cash'
    ? `Cash price, paid directly: ${fmt(facility.rate_used)}`
    : `Cigna-negotiated rate: ${fmt(facility.rate_used)}, estimated patient out-of-pocket: ${fmt(facility.oop)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Care Signals Demo//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${APPOINTMENT.dtStartUTC}`,
    `DTEND:${APPOINTMENT.dtEndUTC}`,
    `SUMMARY:${icsEscape('MRI Lumbar Spine (CPT 72148) - ' + facility.facility)}`,
    `LOCATION:${icsEscape(facility.facility_address || facility.facility)}`,
    `DESCRIPTION:${icsEscape('CPT 72148, MRI lumbar spine without contrast. ' + priceLine + '. Please arrive 15 minutes early.')}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape('Reminder: MRI appointment at ' + facility.facility)}`,
    'TRIGGER:-P3D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// ---------------- assistant-panel copy (page 1), grounded in computed data ----------------
function buildTop3Summary() {
  const ranked = getSortedFacilities().filter((f) => f.oop != null);
  const top3 = ranked.slice(0, 3);
  const rec = ranked[0];
  const priciest = ranked[ranked.length - 1];
  const save = fmt(priciest.oop - rec.oop);
  const lines = top3.map((f, i) => `${i + 1}. ${f.facility} — ${fmt(f.oop)}${i === 0 ? '  ★ recommended' : ''}`);
  return `Top options by patient out-of-pocket:\n\n${lines.join('\n')}\n\n`
       + `Recommended: ${rec.facility} — you'd save ${save} vs. the priciest option.`;
}
function navigatorReply(question) {
  const q = (question || '').toLowerCase();
  const ranked = getSortedFacilities().filter((f) => f.oop != null);
  const rec = ranked[0];
  const priciest = ranked[ranked.length - 1];
  if (/cheap|lowest|best|save|afford/.test(q)) {
    return `${rec.facility} is the lowest at ${fmt(rec.oop)} out-of-pocket — that's the recommended option. Run care navigation to see all four with citations.`;
  }
  if (/expensive|most|highest|priciest|saint francis|hyde/.test(q)) {
    return `${priciest.facility} is the priciest at ${fmt(priciest.oop)}. That's why the recommendation is ${rec.facility} at ${fmt(rec.oop)}.`;
  }
  if (/schedul|book|appoint|reminder|calendar/.test(q)) {
    return `Tap “Run care navigation on this order” — the agent prices the options, texts the patient on WhatsApp, books the recommended slot, and generates a calendar file with a reminder.`;
  }
  return `I can run the full price navigation on this signed order — tap “Run care navigation on this order” to start.`;
}
