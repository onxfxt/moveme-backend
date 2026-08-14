const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

const router = express.Router();
router.use(requireAuth);

// GET /users/me
router.get("/me", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { vehicle: true } });
  res.json(user);
});

// POST /users/me/agree-terms
router.post("/me/agree-terms", async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.userId }, data: { agreedToTerms: true } });
  res.json(user);
});

// POST /users/me/documents  (multipart form: idDoc, licenceDoc, prdpDoc)
// Marks verification back to PENDING any time new documents are submitted —
// admin must (re-)approve before the account can transact.
router.post(
  "/me/documents",
  upload.fields([{ name: "idDoc", maxCount: 1 }, { name: "licenceDoc", maxCount: 1 }, { name: "prdpDoc", maxCount: 1 }]),
  async (req, res) => {
    const files = req.files || {};
    const data = { verification: "PENDING" };
    if (files.idDoc) data.idDocUrl = `/uploads/${files.idDoc[0].filename}`;
    if (files.licenceDoc) data.licenceDocUrl = `/uploads/${files.licenceDoc[0].filename}`;
    if (files.prdpDoc) data.prdpDocUrl = `/uploads/${files.prdpDoc[0].filename}`;
    const user = await prisma.user.update({ where: { id: req.userId }, data });
    res.json(user);
  }
);

// PATCH /users/me/settings  { darkMode?, notifSounds?, pushEnabled?, expoPushToken?, enrouteActive?, enrouteDestination? }
router.patch("/me/settings", async (req, res) => {
  const allowed = ["darkMode", "notifSounds", "pushEnabled", "expoPushToken", "enrouteActive", "enrouteDestination"];
  const data = {};
  for (const k of allowed) if (k in req.body) data[k] = req.body[k];
  const user = await prisma.user.update({ where: { id: req.userId }, data });
  res.json(user);
});

// PATCH /users/me/location  { lat, lng }
// Drivers call this from the Job Board "Share my location" button, and it's
// also used to compute distance-to-pickup on each job card.
router.patch("/me/location", async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "lat and lng must be numbers" });
  const user = await prisma.user.update({ where: { id: req.userId }, data: { lastLat: lat, lastLng: lng } });
  res.json(user);
});

// GET /users/:id/public  — the limited public profile shown to the other party
// (rating, completed jobs count) without exposing phone/documents.
router.get("/:id/public", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Not found" });
  const ratings = await prisma.rating.findMany({ where: { receiverId: user.id } });
  const completedJobs = await prisma.job.count({ where: { driverId: user.id, status: "COMPLETED" } });
  const avgRating = ratings.length ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length : null;
  res.json({ id: user.id, name: user.name, avgRating, ratingCount: ratings.length, completedJobs });
});

// GET /users/me/reviews  — ratings received, with comments, for the Profile screen
router.get("/me/reviews", async (req, res) => {
  const reviews = await prisma.rating.findMany({
    where: { receiverId: req.userId, comment: { not: null } },
    include: { giver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(reviews);
});

module.exports = router;
