const express = require("express");
const prisma = require("../db");
const { requireAdminAuth } = require("../middleware/auth");
const { notifyUser } = require("../services/push");

const router = express.Router();
router.use(requireAdminAuth);

// GET /admin/accounts?status=PENDING|VERIFIED|REJECTED
router.get("/accounts", async (req, res) => {
  const status = req.query.status;
  const where = status ? { verification: status } : {};
  const users = await prisma.user.findMany({ where, include: { vehicle: true }, orderBy: { createdAt: "desc" } });
  res.json(users);
});

// GET /admin/accounts/search?q=phone-or-name
router.get("/accounts/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const users = await prisma.user.findMany({
    where: { OR: [{ name: { contains: q } }, { phone: { contains: q } }] },
    include: { vehicle: true },
    take: 20,
  });
  res.json(users);
});

// GET /admin/accounts/:id  — full detail view: profile, vehicle, jobs, wallet history, messages
router.get("/accounts/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { vehicle: true } });
  if (!user) return res.status(404).json({ error: "Not found" });

  const [jobsAsCustomer, jobsAsDriver, walletTxns, ratingsReceived, adminMessages] = await Promise.all([
    prisma.job.findMany({ where: { customerId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.job.findMany({ where: { driverId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.walletTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.rating.findMany({ where: { receiverId: user.id }, include: { giver: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.adminMessage.findMany({ where: { toUserId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);

  res.json({ user, jobsAsCustomer, jobsAsDriver, walletTxns, ratingsReceived, adminMessages });
});

// PATCH /admin/accounts/:id/verify  { status: 'VERIFIED' | 'REJECTED' }
router.patch("/accounts/:id/verify", async (req, res) => {
  const { status } = req.body;
  if (!["VERIFIED", "REJECTED"].includes(status)) return res.status(400).json({ error: "status must be VERIFIED or REJECTED" });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { verification: status } });
  res.json(user);
});

// GET /admin/jobs?status=&type=
router.get("/jobs", async (req, res) => {
  const { status, type } = req.query;
  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;
  const jobs = await prisma.job.findMany({
    where,
    include: { customer: { select: { id: true, name: true, phone: true } }, driver: { select: { id: true, name: true, phone: true } }, bids: true, ratings: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json(jobs);
});

// GET /admin/jobs/:id/messages  — read a job's chat transcript (oversight / dispute resolution)
router.get("/jobs/:id/messages", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { jobId: req.params.id },
    include: { sender: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
});

// GET /admin/activity  — unified, paginated feed across jobs/wallet/ratings/messages for a full audit trail
router.get("/activity", async (req, res) => {
  const take = Math.min(Number(req.query.take) || 50, 200);

  const [jobs, walletTxns, ratings, messages, adminMessages] = await Promise.all([
    prisma.job.findMany({ orderBy: { createdAt: "desc" }, take, include: { customer: { select: { name: true } }, driver: { select: { name: true } } } }),
    prisma.walletTransaction.findMany({ orderBy: { createdAt: "desc" }, take, include: { user: { select: { name: true } } } }),
    prisma.rating.findMany({ orderBy: { createdAt: "desc" }, take, include: { giver: { select: { name: true } }, receiver: { select: { name: true } } } }),
    prisma.message.findMany({ orderBy: { createdAt: "desc" }, take, include: { sender: { select: { name: true } } } }),
    prisma.adminMessage.findMany({ orderBy: { createdAt: "desc" }, take, include: { toUser: { select: { name: true } } } }),
  ]);

  const events = [
    ...jobs.map((j) => ({ type: "job", at: j.createdAt, summary: `${j.type}${j.subtype ? " (" + j.subtype + ")" : ""} booked by ${j.customer?.name || "?"}${j.driver ? " → " + j.driver.name : ""} — ${j.status}`, data: j })),
    ...walletTxns.map((t) => ({ type: "wallet", at: t.createdAt, summary: `${t.user?.name || "?"}: ${t.kind} ${t.amount >= 0 ? "+" : ""}P${(t.amount / 100).toFixed(0)} (${t.status})`, data: t })),
    ...ratings.map((r) => ({ type: "rating", at: r.createdAt, summary: `${r.giver?.name || "?"} rated ${r.receiver?.name || "?"} ${r.stars}★${r.comment ? ": " + r.comment : ""}`, data: r })),
    ...messages.map((m) => ({ type: "message", at: m.createdAt, summary: `${m.sender?.name || "?"} sent a chat message: "${m.text.slice(0, 60)}"`, data: m })),
    ...adminMessages.map((m) => ({ type: "admin_message", at: m.createdAt, summary: `Admin messaged ${m.toUser?.name || "?"}: "${m.title}"`, data: m })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, take);

  res.json(events);
});

// POST /admin/messages  { toUserId, title, body }
// Sends a push notification + logs a permanent record — this is the
// "communicate with drivers and customers" tool.
router.post("/messages", async (req, res) => {
  const { toUserId, title, body } = req.body;
  if (!toUserId || !title || !body) return res.status(400).json({ error: "toUserId, title, and body are required" });

  const toUser = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!toUser) return res.status(404).json({ error: "User not found" });

  const record = await prisma.adminMessage.create({ data: { toUserId, adminUserId: req.adminId, title, body } });
  await notifyUser(toUser, title, body);
  res.status(201).json(record);
});

// GET /admin/messages  — admin's own sent-message log
router.get("/messages", async (req, res) => {
  const messages = await prisma.adminMessage.findMany({
    include: { toUser: { select: { name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(messages);
});

// GET /admin/stats
router.get("/stats", async (req, res) => {
  const [totalAccounts, totalCustomers, totalDrivers, totalJobs, completedJobs, pendingVerifications] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.user.count({ where: { role: "DRIVER" } }),
    prisma.job.count(),
    prisma.job.findMany({ where: { status: "COMPLETED" } }),
    prisma.user.count({ where: { verification: "PENDING" } }),
  ]);
  const commissionEarnedThebe = completedJobs.reduce((s, j) => s + Math.round((j.price || 0) * j.commissionRate), 0);
  const grossBookingValueThebe = completedJobs.reduce((s, j) => s + (j.price || 0), 0);

  res.json({
    totalAccounts,
    totalCustomers,
    totalDrivers,
    totalJobs,
    completedJobCount: completedJobs.length,
    pendingVerifications,
    commissionEarnedThebe,
    grossBookingValueThebe,
  });
});

module.exports = router;
