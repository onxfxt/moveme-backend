const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const prisma = require("../db");
const { requireAdminAuth } = require("../middleware/auth");

const router = express.Router();

// Slows down password-guessing attempts against the admin terminal.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "Too many login attempts — try again in 15 minutes." } });

function signAdminToken(admin) {
  // A distinct token "kind" (admin vs regular user) so a leaked customer/driver
  // token can never be replayed against admin routes, and vice versa.
  return jwt.sign({ sub: admin.id, kind: "admin", role: admin.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
}

// POST /admin-auth/login  { email, password }
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const admin = await prisma.adminAccount.findUnique({ where: { email: email.toLowerCase().trim() } });
  // Constant-shape response whether the email exists or not, so the API
  // can't be used to enumerate valid admin email addresses.
  if (!admin || !admin.active) return res.status(401).json({ error: "Invalid email or password" });

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  await prisma.adminAccount.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const token = signAdminToken(admin);
  res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
});

// GET /admin-auth/me
router.get("/me", requireAdminAuth, async (req, res) => {
  const admin = await prisma.adminAccount.findUnique({ where: { id: req.adminId } });
  if (!admin) return res.status(404).json({ error: "Not found" });
  res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });
});

// POST /admin-auth/change-password  { currentPassword, newPassword }
router.post("/change-password", requireAdminAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword must be at least 8 characters" });
  }
  const admin = await prisma.adminAccount.findUnique({ where: { id: req.adminId } });
  const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.adminAccount.update({ where: { id: admin.id }, data: { passwordHash } });
  res.json({ ok: true });
});

// ---- Owner-only: manage other admin/staff accounts ----

// GET /admin-auth/accounts  (owner only)
router.get("/accounts", requireAdminAuth, async (req, res) => {
  if (req.adminRole !== "owner") return res.status(403).json({ error: "Owner access only" });
  const accounts = await prisma.adminAccount.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } });
  res.json(accounts);
});

// POST /admin-auth/accounts  { name, email, password, role }  (owner only)
router.post("/accounts", requireAdminAuth, async (req, res) => {
  if (req.adminRole !== "owner") return res.status(403).json({ error: "Owner access only" });
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "name, email, and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const account = await prisma.adminAccount.create({
      data: { name, email: email.toLowerCase().trim(), passwordHash, role: role === "owner" ? "owner" : "staff" },
    });
    res.status(201).json({ id: account.id, name: account.name, email: account.email, role: account.role });
  } catch (e) {
    res.status(409).json({ error: "An admin account with that email already exists" });
  }
});

// PATCH /admin-auth/accounts/:id  { active? }  (owner only — e.g. to disable a staff member who leaves)
router.patch("/accounts/:id", requireAdminAuth, async (req, res) => {
  if (req.adminRole !== "owner") return res.status(403).json({ error: "Owner access only" });
  const { active } = req.body;
  const account = await prisma.adminAccount.update({ where: { id: req.params.id }, data: { active: !!active } });
  res.json({ id: account.id, active: account.active });
});

module.exports = router;
