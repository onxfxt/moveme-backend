const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../db");
const { generateCode, sendOtp } = require("../services/otp");
const { signToken } = require("../middleware/auth");

const router = express.Router();

// Prevents someone from spamming a phone number with OTP requests.
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, message: { error: "Too many OTP requests — try again in 10 minutes." } });

// POST /auth/request-otp  { phone, name?, country?, role? }
// Creates the user record on first request (name/country/role required then),
// or reuses it on subsequent logins.
router.post("/request-otp", otpLimiter, async (req, res) => {
  const { phone, name, country, role } = req.body;
  if (!phone) return res.status(400).json({ error: "phone is required" });

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    if (!name || !role) {
      return res.status(400).json({ error: "First-time sign-up requires name and role" });
    }
    if (!["CUSTOMER", "DRIVER"].includes(role)) {
      return res.status(400).json({ error: "role must be CUSTOMER or DRIVER" });
    }
    user = await prisma.user.create({
      data: { phone, name, country: country || "Botswana", role },
    });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.otpCode.create({ data: { userId: user.id, phone, code, expiresAt } });
  await sendOtp(phone, code);

  res.json({ ok: true, message: "OTP sent" });
});

// POST /auth/verify-otp  { phone, code }
router.post("/verify-otp", async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: "phone and code are required" });

  const otp = await prisma.otpCode.findFirst({
    where: { phone, code, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return res.status(400).json({ error: "Invalid or expired code" });

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
  const user = await prisma.user.findUnique({ where: { phone }, include: { vehicle: true } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = signToken(user);
  res.json({ token, user });
});

// POST /auth/agree-terms  (auth required — placed here for grouping; router.use added in index.js)
module.exports = router;
