// Shared SMS-text builder — loaded as a plain <script> in options_card.html
// AND required() as a CommonJS module in server.js. Keeping this in one file
// is what guarantees the live SMS and the mock SMS say the exact same thing.

function fmtCurrency(n) {
  return n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function sortedFacilities(FACILITIES) {
  return [...FACILITIES].sort((a, b) => {
    const av = a.oop == null ? Infinity : a.oop;
    const bv = b.oop == null ? Infinity : b.oop;
    return av - bv;
  });
}

function clinicianLastName(ENCOUNTER) {
  const full = ENCOUNTER.signed_order.ordering_clinician.split(',')[0].trim(); // "Dr. A. Rivera"
  const parts = full.split(' ');
  return parts[parts.length - 1];
}

function buildOptionsSmsText(FACILITIES, ENCOUNTER) {
  const sorted = sortedFacilities(FACILITIES).filter((f) => f.oop != null);
  if (sorted.length < 2) {
    return 'Not enough published prices yet to compare facilities for this patient.';
  }
  const cheapest = sorted[0];
  const priciest = sorted[sorted.length - 1];
  const delta = fmtCurrency(priciest.oop - cheapest.oop);
  const firstName = ENCOUNTER.patient.name.split(' ')[0];
  const cheapestDistance = cheapest.distance_from_patient ? ` (${cheapest.distance_from_patient})` : '';

  return (
    `Hi ${firstName} — Dr. ${clinicianLastName(ENCOUNTER)} ordered an MRI of your lower back. ` +
    `We checked prices for your ${ENCOUNTER.patient.insurance.payer} plan:\n\n` +
    `${cheapest.facility}${cheapestDistance} — ${fmtCurrency(cheapest.oop)}\n` +
    `${priciest.facility} — ${fmtCurrency(priciest.oop)}\n\n` +
    `Same scan. You'd save ${delta} at ${cheapest.facility}.\n\n` +
    `Reply SCHEDULE and we'll book it for you.`
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildOptionsSmsText, sortedFacilities, fmtCurrency, clinicianLastName };
}
