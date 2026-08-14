const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// POST /jobs/:id/ratings  { stars, comment? }
// Customers rating a driver may leave a comment; drivers rating a customer may not
// (enforced here, not just in the UI, so the rule can't be bypassed by calling the API directly).
router.post("/:id/ratings", async (req, res) => {
  const { stars, comment } = req.body;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: "stars must be an integer 1-5" });

  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "COMPLETED") return res.status(400).json({ error: "Job must be completed before rating" });

  let giverId, receiverId, allowComment;
  if (req.userId === job.customerId) {
    giverId = job.customerId; receiverId = job.driverId; allowComment = true;
  } else if (req.userId === job.driverId) {
    giverId = job.driverId; receiverId = job.customerId; allowComment = false;
  } else {
    return res.status(403).json({ error: "Not part of this job" });
  }

  const existing = await prisma.rating.findFirst({ where: { jobId: job.id, giverId } });
  if (existing) return res.status(409).json({ error: "Already rated" });

  const rating = await prisma.rating.create({
    data: { jobId: job.id, giverId, receiverId, stars, comment: allowComment ? (comment || null) : null },
  });
  res.status(201).json(rating);
});

module.exports = router;
