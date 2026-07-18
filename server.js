#!/usr/bin/env node
"use strict";

/*
 * Real two-way SMS beat for the Care Signals demo.
 * Run with: node server.js  (after `npm install` and setting up .env — see .env.example)
 *
 * POST /send     -- sends the options-comparison text (identical to the mock,
 *                    via sms-text.js) to TO_PHONE_NUMBER through Twilio.
 * POST /webhook  -- Twilio inbound-SMS webhook. Calls Claude with the patient's
 *                    plan + all facility data as grounding, sends the reply back.
 *
 * Also serves this directory statically so the "Send to patient (live)" button
 * in options_card.html can hit /send via a relative fetch() when the page is
 * opened at http://localhost:<port>/options_card.html.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { buildOptionsSmsText, sortedFacilities, fmtCurrency } = require("./sms-text");

const DIR = __dirname;

const REQUIRED_ENV = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TO_PHONE_NUMBER",
  "ANTHROPIC_API_KEY",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `Missing required environment variable(s): ${missing.join(", ")}\n` +
      `Copy .env.example to .env and fill them in before running server.js.`
  );
  process.exit(1);
}

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  TO_PHONE_NUMBER,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  PORT,
  TWILIO_VALIDATE_SIGNATURE,
  MESSAGING_CHANNEL,
} = process.env;

const MODEL = ANTHROPIC_MODEL || "claude-sonnet-4-6";
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// "sms" (default) or "whatsapp" -- whatsapp uses Twilio's Sandbox, which needs
// no A2P 10DLC compliance registration. Numbers get the "whatsapp:" scheme
// prefix; Twilio's webhook signature validation works unchanged either way.
const CHANNEL = (MESSAGING_CHANNEL || "sms").toLowerCase();
function toChannelAddress(num) {
  if (CHANNEL !== "whatsapp") return num;
  return num.startsWith("whatsapp:") ? num : `whatsapp:${num}`;
}
const FROM_ADDRESS = toChannelAddress(TWILIO_PHONE_NUMBER);
const TO_ADDRESS = toChannelAddress(TO_PHONE_NUMBER);

// Same fixed synthetic slot options_card.html's confirm beat uses -- kept here
// too so the SMS-reply agent can reference it if a reply asks about scheduling.
const APPOINTMENT = {
  dateDisplay: "Wednesday, July 22, 2026",
  timeDisplay: "9:30 AM – 10:00 AM",
};

function timestamp() {
  return new Date().toISOString();
}

// In-memory conversation history, keyed by the inbound "From" address. Without
// this, every webhook call was a single memory-less turn -- the model had no
// idea what it had already asked or what the patient had already answered,
// which is exactly what caused the repeated-question loop. Capped so token
// usage/cost don't grow unbounded on a long back-and-forth; resets on server
// restart (fine for a demo -- not meant to survive process restarts).
const MAX_HISTORY_MESSAGES = 12; // 6 user/assistant exchanges
const conversations = new Map();

function getHistory(from) {
  return conversations.get(from) || [];
}

function appendToHistory(from, userText, assistantText) {
  const history = getHistory(from);
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: assistantText });
  while (history.length > MAX_HISTORY_MESSAGES) history.shift();
  conversations.set(from, history);
}

function logMessage(direction, counterparty, body) {
  console.log(`[${timestamp()}] ${direction} ${counterparty}: ${body.replace(/\n/g, " | ")}`);
}

// agent_output.js / encounter_output.js are `const X = <JSON>;` files written by
// agent.js. Extracting the JSON substring keeps this server reading the exact
// same generated data the browser page loads via <script src> -- no separate
// data-loading path to drift out of sync.
function loadAgentOutputs() {
  const facRaw = fs.readFileSync(path.join(DIR, "agent_output.js"), "utf8");
  const encRaw = fs.readFileSync(path.join(DIR, "encounter_output.js"), "utf8");
  const FACILITIES = JSON.parse(facRaw.slice(facRaw.indexOf("["), facRaw.lastIndexOf("]") + 1));
  const ENCOUNTER = JSON.parse(encRaw.slice(encRaw.indexOf("{"), encRaw.lastIndexOf("}") + 1));
  return { FACILITIES, ENCOUNTER };
}

function buildSystemPrompt(FACILITIES, ENCOUNTER) {
  const ins = ENCOUNTER.patient.insurance;
  const sorted = sortedFacilities(FACILITIES);

  const facilityLines = sorted
    .map((f) => {
      const rate = f.rate_used != null ? fmtCurrency(f.rate_used) : "not published";
      const oop = f.oop != null ? fmtCurrency(f.oop) : "not published";
      return (
        `- ${f.facility} (${f.facility_type}): billed rate ${rate} [${f.rate_type}], ` +
        `patient out-of-pocket ${oop}, distance ${f.distance_from_patient || "unknown"}, ` +
        `address ${f.facility_address || "unknown"}, source: ${f.source_url || "no source on file"}`
      );
    })
    .join("\n");

  return [
    "You are a patient-care agent texting on the patient's behalf about an MRI lumbar spine (CPT 72148) price comparison.",
    `Patient: ${ENCOUNTER.patient.name}. Plan: ${ins.payer} ${ins.plan}. ` +
      `Deductible: $${ins.deductible_met.toFixed(2)} of $${ins.deductible_total.toFixed(2)} met. ` +
      `Coinsurance after deductible: ${Math.round(ins.coinsurance_rate_after_deductible * 100)}%.`,
    "",
    "Facility data -- this is your ONLY source of truth. Never invent a price or a fact about a facility that is not listed here:",
    facilityLines,
    "",
    `If scheduling comes up, the currently held appointment slot is ${APPOINTMENT.dateDisplay}, ${APPOINTMENT.timeDisplay}.`,
    "",
    "Rules:",
    "- Answer ONLY from the facility data above.",
    "- If you can't answer from this data, say so plainly and offer to connect a human -- do not guess.",
    "- Replies must be under 300 characters.",
    "- Warm, plain language. No medical jargon, no insurance jargon, no markdown, no bullet lists -- this is a text message.",
    "- You have the full conversation history. Do NOT re-ask a question the patient already answered earlier in this thread (e.g. which facility, whether to schedule) -- check history first.",
    "- You cannot actually book an appointment over this channel -- there is no real scheduling system behind this text thread. Once the patient has confirmed a facility and the held time slot, acknowledge that clearly in one message and say a scheduler will follow up to finalize it. Do not ask 'which facility' more than once per conversation.",
  ].join("\n");
}

const app = express();
app.set("trust proxy", true); // ngrok sits in front of us; needed for Twilio signature validation
app.use(express.urlencoded({ extended: false })); // Twilio webhooks post form-encoded bodies
app.use(express.json());
app.use(express.static(DIR)); // serves options_card.html, agent_output.js, etc. for the live-send button

app.post("/send", async (req, res) => {
  try {
    const { FACILITIES, ENCOUNTER } = loadAgentOutputs();
    const body = buildOptionsSmsText(FACILITIES, ENCOUNTER);

    const message = await twilioClient.messages.create({
      body,
      from: FROM_ADDRESS,
      to: TO_ADDRESS,
    });

    logMessage("OUT ->", TO_ADDRESS, body);
    res.json({ ok: true, sid: message.sid });
  } catch (err) {
    console.error(`[${timestamp()}] POST /send failed:`, err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

function validateTwilioSignature(req, res, next) {
  if (TWILIO_VALIDATE_SIGNATURE === "false") return next();

  const signature = req.header("X-Twilio-Signature");
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body);

  if (!valid) {
    console.error(`[${timestamp()}] Rejected /webhook request with invalid Twilio signature.`);
    return res.status(403).send("Invalid signature");
  }
  next();
}

app.post("/webhook", validateTwilioSignature, async (req, res) => {
  const from = req.body.From;
  const inboundText = req.body.Body || "";
  logMessage("IN  <-", from, inboundText);

  try {
    const { FACILITIES, ENCOUNTER } = loadAgentOutputs();
    const systemPrompt = buildSystemPrompt(FACILITIES, ENCOUNTER);

    const history = getHistory(from);
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages: [...history, { role: "user", content: inboundText }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    let replyText = textBlock ? textBlock.text : "";
    if (!replyText) {
      replyText = "Sorry, I couldn't put together an answer. I'll have a person follow up with you shortly.";
    }
    if (replyText.length > 300) {
      replyText = replyText.slice(0, 297) + "...";
    }

    appendToHistory(from, inboundText, replyText);

    await twilioClient.messages.create({
      body: replyText,
      from: FROM_ADDRESS,
      to: from, // Twilio already sends req.body.From with the whatsapp: prefix on WhatsApp channel
    });
    logMessage("OUT ->", from, replyText);

    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    console.error(`[${timestamp()}] POST /webhook failed:`, err);
    // Still ack Twilio with empty TwiML so it doesn't retry-storm us.
    res.type("text/xml").send("<Response></Response>");
  }
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`[${timestamp()}] Care Signals live-SMS server listening on http://localhost:${port}`);
  console.log(`[${timestamp()}] Open http://localhost:${port}/options_card.html to use the "Send to patient (live)" button.`);
  console.log(`[${timestamp()}] Channel: ${CHANNEL}  |  ${FROM_ADDRESS}  ->  ${TO_ADDRESS}`);
  console.log(`[${timestamp()}] Model for inbound replies: ${MODEL}`);
});
