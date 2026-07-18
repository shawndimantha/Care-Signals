# Run Notes — 2026-07-18, fifth pass (real two-way SMS via Twilio + Claude)

## What changed

**`sms-text.js` (new)** — extracted the SMS-text-building logic (`buildOptionsSmsText`, `sortedFacilities`, `fmtCurrency`, `clinicianLastName`) out of `options_card.html`'s inline script into its own file, written so it works both as a plain `<script src>` global in the browser and as a `require()`-able CommonJS module in Node. `options_card.html`'s mock-SMS renderer now calls this shared function instead of its own copy. This is what makes "the real send uses the same text the mock generates" literally true rather than two hand-synced copies — `server.js` and the browser mock both call the identical function.

**`server.js` (new)** — Express server, two endpoints:
- `POST /send` — loads `agent_output.js` + `encounter_output.js` (same files the browser page already loads), builds the options text via `sms-text.js`, sends it through Twilio to `TO_PHONE_NUMBER`.
- `POST /webhook` — Twilio inbound-SMS webhook. Validates the Twilio request signature (`twilio.validateRequest`, using `X-Twilio-Signature` + the reconstructed URL; skippable locally via `TWILIO_VALIDATE_SIGNATURE=false`). Builds a system prompt from the patient's plan/deductible and **every** facility's price, distance, source URL, and rate type, calls `claude-sonnet-4-6` (configurable via `ANTHROPIC_MODEL`) with the inbound text as the only user turn, and texts the reply back. The system prompt explicitly instructs: answer only from the supplied facility data, never invent a price or fact, say so and offer a human handoff if the data doesn't cover the question, stay under 300 characters, warm and plain-language, no markdown (it's a text message). Every inbound and outbound message is logged to the terminal with an ISO timestamp via a `logMessage()` helper, so the exchange is visible live during a demo.
- Also serves the project directory statically (`express.static(__dirname)`), so opening `http://localhost:3000/options_card.html` makes the new live-send button's relative `fetch('/send')` work same-origin.

**`options_card.html`** — added a **"Send to patient (live)"** button next to (not replacing) the existing mock "Send options to patient" button, plus a status line. Clicking it POSTs to `/send` and reports the Twilio SID on success or a clear inline error otherwise (e.g. "is server.js running, and is this page loaded from http://localhost, not file://?"). The existing mock SMS button, panel, and all Confirm/`.ics` functionality are untouched.

**Credentials** — `.env.example` added (Twilio SID/token/from-number, the real verified `TO_PHONE_NUMBER`, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`/`PORT`/`TWILIO_VALIDATE_SIGNATURE`). `.gitignore` now excludes `.env`. `package.json` added (`express`, `twilio`, `@anthropic-ai/sdk`, `dotenv`) and `npm install` has been run — `node_modules/` and `package-lock.json` are present locally.

**Bug caught and fixed during verification:** the inline script in `options_card.html` originally had its own zero-arg helper also named `sortedFacilities()`. Since classic `<script>` tags share one global scope, that declaration silently overwrote `sms-text.js`'s `sortedFacilities(FACILITIES)` — calling it from inside itself caused infinite recursion, and the whole options card rendered empty. Renamed the local wrapper to `getSortedFacilities()`; verified the bug and the fix both in a real browser before moving on.

## What I did NOT do, and why

I did **not** run the actual end-to-end verification (start the server against real credentials, expose `/webhook` via ngrok, set that URL as the Twilio number's Messaging webhook, and complete a real outbound → reply → agent-response round trip). Three reasons, all independent:

1. **No credentials exist in this environment.** No `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/Twilio phone number, no `ANTHROPIC_API_KEY`, and no `ngrok` binary or Twilio CLI installed here.
2. **Sending real SMS costs real money per message** and hits a real phone.
3. **Registering the ngrok URL as the Twilio number's webhook overwrites whatever that number's Messaging webhook currently points to** — a live account configuration change to infrastructure outside this repo, on a number that might be used for other things.

Those are exactly the kind of side-effecting, cost-incurring, external-account-modifying actions I check in before doing, even when asked to do them as part of a larger task — so I built and verified everything I could offline, and I'm stopping here to ask rather than guessing at your Twilio setup.

## What I did verify (safe, no real send)

- `sms-text.js`'s output matches the mock SMS text exactly (unit-tested directly via `node -e`).
- `server.js` boots and exits cleanly with a clear message when required env vars are missing (`node server.js` → lists the missing var names, exit code 1, no crash trace).
- With dummy (fake-format) credentials in a throwaway `.env`: the server starts, serves `options_card.html` over HTTP, and `POST /send` fails **gracefully** with Twilio's real "Authentication Error - invalid username" (proves the request shape and error path work; a real SID/token would succeed the same way).
- Clicked "Send to patient (live)" in a real Playwright-driven Chromium session against the running server: the button correctly POSTs, the fetch fails on the fake Twilio auth (as expected), and the failure renders inline as `"Live send failed... (Authentication Error - invalid username)"` — confirming the full browser → Express → Twilio-client → JSON-error → UI-display chain works.
- Re-ran the full existing Playwright suite (patient sidebar, distance, confirm/schedule, `.ics` generation) against the updated `options_card.html` — all green, zero console/page errors, after the `sortedFacilities` fix above.
- Confirmed `.env` is git-ignored and untracked (`git check-ignore -v .env`, `git ls-files | grep .env`) after creating and deleting a real (dummy-valued) `.env` file.

## What I need from you to finish this

To actually run the live round trip, I need either the values themselves or your go-ahead to proceed once you've set them:

1. **Twilio**: Account SID, Auth Token, and a Twilio phone number capable of sending/receiving SMS.
2. **A real phone number you control** to act as the demo "patient" (`TO_PHONE_NUMBER`) — the fictional `(555) 014-2938` in `demo_encounter.json` can't receive real texts.
3. **An Anthropic API key.**
4. **ngrok** (not installed here — `brew install ngrok` or `npm install -g ngrok`, plus an ngrok account/authtoken) to expose `POST /webhook` publicly so Twilio can reach it.

Once those exist, the remaining steps are: `cp .env.example .env` and fill it in → `node server.js` → `ngrok http 3000` → copy the `https://*.ngrok-free.app/webhook` URL into the Twilio number's **Messaging → "A message comes in"** webhook (Console or `twilio phone-numbers:update`) → click "Send to patient (live)" or `curl -X POST http://localhost:3000/send` → reply from your phone → watch the terminal log both directions and the reply arrive by SMS. I'll do all of that on your confirmation, since the last three of those steps are exactly the real-money/real-account-change actions described above.
