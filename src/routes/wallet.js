const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const payments = require("../services/payments");

const router = express.Router();
router.use(requireAuth);

// GET /wallet/me
router.get("/me", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  const txns = await prisma.walletTransaction.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 100 });

  const now = Date.now();
  const day = 86400000;
  const earned = (ms) => txns.filter((t) => t.kind === "job_earning" && now - t.createdAt.getTime() < ms).reduce((s, t) => s + t.amount, 0);

  res.json({
    balanceThebe: user.walletBalance,
    today: earned(day),
    week: earned(day * 7),
    month: earned(day * 30),
    transactions: txns,
  });
});

// POST /wallet/topup/initiate  { amountThebe }
// Starts a REAL payment: returns a checkout URL for the mobile app to open.
// The wallet is NOT credited here — only the webhook (see routes/webhooks.js)
// credits it, and only after independently verifying the transaction with
// the provider.
router.post("/topup/initiate", async (req, res) => {
  const { amountThebe } = req.body;
  if (!amountThebe || amountThebe <= 0) return res.status(400).json({ error: "amountThebe must be positive" });
  if (!payments.isConfigured()) {
    return res.status(503).json({
      error: "Payments are not configured yet. Set FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH in the backend .env, or use /wallet/topup/dev-instant while developing.",
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  try {
    const { checkoutUrl, txRef } = await payments.initiateTopup({
      userId: req.userId,
      amountThebe,
      customerPhone: user.phone,
      redirectUrl: process.env.PAYMENT_REDIRECT_URL || "https://moveme.co.bw/payment-complete",
    });

    await prisma.walletTransaction.create({
      data: { userId: req.userId, amount: amountThebe, kind: "topup_pending", status: "pending", reference: txRef },
    });

    res.json({ checkoutUrl, txRef });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /wallet/topup/dev-instant  { amountThebe }
// DEVELOPMENT ONLY. Credits the wallet immediately with no real payment —
// exactly like the old prototype. This route refuses to run once
// NODE_ENV=production, specifically so it can never accidentally ship live.
router.post("/topup/dev-instant", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Dev-only endpoint disabled in production. Use /wallet/topup/initiate instead." });
  }
  const { amountThebe } = req.body;
  if (!amountThebe || amountThebe <= 0) return res.status(400).json({ error: "amountThebe must be positive" });

  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: req.userId }, data: { walletBalance: { increment: amountThebe } } }),
    prisma.walletTransaction.create({ data: { userId: req.userId, amount: amountThebe, kind: "topup", status: "confirmed", reference: "dev-instant" } }),
  ]);

  res.json({ balanceThebe: user.walletBalance, warning: "Credited via dev-instant — this path is disabled in production." });
});

module.exports = router;
