const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { notifyUser } = require("../services/push");

const router = express.Router();
router.use(requireAuth);

async function assertParticipant(req, res, next) {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (req.userId !== job.customerId && req.userId !== job.driverId) return res.status(403).json({ error: "Not part of this job" });
  req.job = job;
  next();
}

// GET /jobs/:id/messages
router.get("/:id/messages", assertParticipant, async (req, res) => {
  const messages = await prisma.message.findMany({ where: { jobId: req.params.id }, orderBy: { createdAt: "asc" } });
  res.json(messages);
});

// POST /jobs/:id/messages  { text }
router.post("/:id/messages", assertParticipant, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

  const message = await prisma.message.create({ data: { jobId: req.params.id, senderId: req.userId, text: text.trim() } });

  const otherPartyId = req.userId === req.job.customerId ? req.job.driverId : req.job.customerId;
  if (otherPartyId) {
    const otherParty = await prisma.user.findUnique({ where: { id: otherPartyId } });
    const sender = await prisma.user.findUnique({ where: { id: req.userId } });
    await notifyUser(otherParty, "New message", `${sender.name}: ${text.trim().slice(0, 80)}`);
  }

  const io = req.app.get("io");
  if (io) io.to(`job:${req.job.id}`).emit("message:new", message);

  res.status(201).json(message);
});

module.exports = router;
