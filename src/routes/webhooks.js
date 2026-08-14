const express = require("express");
const prisma = require("../db");
const payments = require("../services/payments");
const { notifyUser } = require("../services/push");

const router = express.Router();

// POST /webhooks/flutterwave
// This is called by Flutterwave's servers, never by the mobile app directly.
// No requireAuth here — the caller isn't one of our logged-in users, it's
// the payment provider. Trust is established entirely through the
// signature check below instead of a JWT.
router.post("/flutterwave", async (req, res) => {
  const signature = req.headers["verif-hash"];
  if (!payments.verifyWebhookSignature(signature)) {
    console.warn("Rejected webhook call with invalid/missing signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.body;
  const txRef = event?.data?.tx_ref;
  const transactionId = event?.data?.id;
  const providerStatus = event?.data?.status; // "successful" | "failed" | ...

  if (!txRef || !transactionId) return res.status(400).json({ error: "Malformed webhook payload" });

  // Find the pending top-up we created in /wallet/topup/initiate.
  const pending = await prisma.walletTransaction.findFirst({ where: { reference: txRef, kind: "topup_pending" } });
  if (!pending) {
    // Either already processed (Flutterwave retries webhooks) or unknown reference — acknowledge either way so it stops retrying.
    return res.json({ ok: true, note: "No matching pending transaction (may already be processed)" });
  }

  if (providerStatus !== "successful") {
    await prisma.walletTransaction.update({ where: { id: pending.id }, data: { status: "failed" } });
    return res.json({ ok: true });
  }

  // NEVER trust event.data.status alone — re-verify server-to-server against
  // Flutterwave's own API, confirming both the amount and currency match
  // what we expect, before crediting anything.
  const verification = await payments.verifyTransaction(transactionId);
  const verifiedAmountBwp = verification?.data?.amount;
  const verifiedCurrency = verification?.data?.currency;
  const expectedAmountBwp = pending.amount / 100;

  if (
    verification?.status !== "success" ||
    verification?.data?.status !== "successful" ||
    verifiedCurrency !== "BWP" ||
    Math.abs(verifiedAmountBwp - expectedAmountBwp) > 0.01
  ) {
    console.error("Webhook claimed success but server-side verification failed", { txRef, verification });
    await prisma.walletTransaction.update({ where: { id: pending.id }, data: { status: "failed" } });
    return res.status(400).json({ error: "Verification mismatch" });
  }

  const [, user] = await prisma.$transaction([
    prisma.walletTransaction.update({ where: { id: pending.id }, data: { kind: "topup", status: "confirmed" } }),
    prisma.user.update({ where: { id: pending.userId }, data: { walletBalance: { increment: pending.amount } } }),
  ]);

  await notifyUser(user, "Top-up successful", `P${(pending.amount / 100).toFixed(0)} added to your wallet.`);
  res.json({ ok: true });
});

module.exports = router;
