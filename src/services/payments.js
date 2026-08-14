// REAL PAYMENT INTEGRATION — Flutterwave
// -----------------------------------------
// Flutterwave is used here because it supports card payments, mobile money
// (including Orange Money in several African markets), and settles in BWP
// or via multi-currency accounts — see https://developer.flutterwave.com
// You can swap this file for DPO Pay or Stripe following the same shape
// (initiateTopup + verifyWebhookSignature + parseWebhookEvent) without
// touching the routes that call it.
//
// THE GOLDEN RULE THIS FILE ENFORCES: the wallet is never credited because
// the app *says* payment succeeded. It's only credited when Flutterwave's
// servers call our webhook AND that webhook's signature checks out. A
// malicious client cannot fake this — they don't have the secret hash.

const crypto = require("crypto");

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || "";
const FLW_WEBHOOK_HASH = process.env.FLUTTERWAVE_WEBHOOK_HASH || "";
const FLW_BASE_URL = "https://api.flutterwave.com/v3";

function isConfigured() {
  return Boolean(FLW_SECRET_KEY && FLW_WEBHOOK_HASH);
}

/**
 * Starts a payment. Returns a checkout URL the mobile app opens in a
 * browser/WebView; the user completes payment there (card or mobile money),
 * then Flutterwave redirects back and — more importantly — calls our
 * webhook independently of whatever the client does next.
 */
async function initiateTopup({ userId, amountThebe, customerEmail, customerPhone, redirectUrl }) {
  if (!isConfigured()) {
    throw new Error(
      "Payment provider not configured. Set FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH in .env before accepting real payments."
    );
  }

  const txRef = `moveme-topup-${userId}-${Date.now()}`;
  const amountBwp = (amountThebe / 100).toFixed(2);

  const res = await fetch(`${FLW_BASE_URL}/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: txRef,
      amount: amountBwp,
      currency: "BWP",
      redirect_url: redirectUrl,
      customer: { email: customerEmail || `${customerPhone}@moveme.co.bw`, phonenumber: customerPhone },
      customizations: { title: "moveMe Wallet Top-up", description: `Top up wallet by P${amountBwp}` },
      meta: { userId, amountThebe, purpose: "wallet_topup" },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.status !== "success") {
    throw new Error(data.message || "Failed to start payment");
  }

  return { checkoutUrl: data.data.link, txRef };
}

/**
 * Flutterwave signs every webhook call with a shared secret hash you set in
 * your dashboard AND in FLUTTERWAVE_WEBHOOK_HASH. If the header doesn't
 * match exactly, the request did not come from Flutterwave — reject it.
 */
function verifyWebhookSignature(headerSignature) {
  if (!isConfigured()) return false;
  if (!headerSignature) return false;
  // Flutterwave sends the raw hash (not HMAC'd) in the verif-hash header —
  // a direct, constant-time comparison is what their docs specify.
  const a = Buffer.from(headerSignature);
  const b = Buffer.from(FLW_WEBHOOK_HASH);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Independently re-verifies the transaction against Flutterwave's own API
 * (never trust the webhook payload's "successful" claim alone — always
 * confirm server-to-server, which defeats replayed/forged webhook bodies).
 */
async function verifyTransaction(transactionId) {
  const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
  });
  const data = await res.json();
  return data;
}

module.exports = { isConfigured, initiateTopup, verifyWebhookSignature, verifyTransaction };
