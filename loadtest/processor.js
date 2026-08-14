const fs = require("fs");
const path = require("path");

const raceDataPath = path.join(__dirname, "data", "race-condition.json");
const raceData = fs.existsSync(raceDataPath) ? JSON.parse(fs.readFileSync(raceDataPath, "utf8")) : null;
let cursor = 0;

// Called once per virtual user, right before it runs the scenario's flow.
// Hands out one driver token per VU, round-robin, so N virtual users means
// N distinct real accounts racing over the same job — not N copies of one
// account (which would test something different: not "which driver wins"
// but just "does the server crash under repeated identical requests").
function assignDriverToken(context, events, done) {
  const driver = raceData.drivers[cursor % raceData.drivers.length];
  cursor += 1;
  context.vars.jobId = raceData.jobId;
  context.vars.token = driver.token;
  context.vars.driverLabel = driver.id;
  return done();
}

// Called after every response in the flow — logs who actually won as it happens.
// (Final pass/fail verdict comes from verify-race-result.js after the run,
// which checks the database directly rather than trusting captured HTTP
// responses — the more trustworthy source of truth for "did this actually
// double-book the job".)
function recordAcceptResult(requestParams, response, context, events, done) {
  if (response.statusCode === 200) {
    console.log(`✅ Driver ${context.vars.driverLabel} got a 200 (won the job).`);
  } else if (response.statusCode === 409) {
    console.log(`   Driver ${context.vars.driverLabel} got a 409 (already taken) — expected for everyone except the winner.`);
  } else {
    console.log(`⚠️  Driver ${context.vars.driverLabel} got an UNEXPECTED status ${response.statusCode}: ${response.body}`);
  }
  return done();
}

// ---------- Wallet burst test functions ----------

const walletData = fs.existsSync(path.join(__dirname, "data", "wallet-burst.json"))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, "data", "wallet-burst.json"), "utf8"))
  : null;
let walletCursor = 0;

// 80% of virtual users top up their OWN distinct account (tests overall
// throughput); 20% all pile onto the single "hammered" account (tests that
// concurrent writes to the SAME balance never get lost — see
// verify-wallet-result.js for how that gets checked afterwards).
function assignWalletTarget(context, events, done) {
  const hitHammered = Math.random() < 0.2;
  if (hitHammered) {
    context.vars.token = walletData.hammered.token;
    context.vars.walletLabel = "HAMMERED";
  } else {
    const u = walletData.users[walletCursor % walletData.users.length];
    walletCursor += 1;
    context.vars.token = u.token;
    context.vars.walletLabel = u.id;
  }
  context.vars.amountThebe = walletData.topupAmountThebe;
  return done();
}

function recordTopupResult(requestParams, response, context, events, done) {
  if (response.statusCode !== 200) {
    console.log(`⚠️  Top-up for ${context.vars.walletLabel} got status ${response.statusCode}: ${response.body}`);
  }
  return done();
}

module.exports = { assignDriverToken, recordAcceptResult, assignWalletTarget, recordTopupResult };
