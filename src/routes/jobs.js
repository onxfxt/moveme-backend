const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { rideFareThebe, truckFareThebe, commissionRateFor } = require("../services/pricing");
const { haversineKm } = require("../services/geo");
const { notifyUser } = require("../services/push");

const { getUserStatsMap } = require("../services/reputation");
const router = express.Router();
router.use(requireAuth);

const COMMISSION_RATES = {
  ride: Number(process.env.COMMISSION_RIDE || 0.11),
  courier: Number(process.env.COMMISSION_COURIER || 0.11),
  moving: Number(process.env.COMMISSION_MOVING || 0.12),
  waste: Number(process.env.COMMISSION_WASTE || 0.11),
};

function emit(req, event, payload) {
  const io = req.app.get("io");
  if (io) io.emit(event, payload);
}

// POST /jobs
// body varies by type — see mobile/src/api/client.ts createJob() for the exact shapes sent.
router.post("/", async (req, res) => {
  const { type, subtype, rideTier, pickup, dropoff, stops, itemDesc, description, distanceKm, pickupLat, pickupLng,
          capacityTier, destination, offerPriceThebe, custom, scheduledFor } = req.body;

  if (!["RIDE", "COURIER", "MOVING", "WASTE"].includes(type)) return res.status(400).json({ error: "Invalid job type" });

  let suggestedFare = null;
  let status = "OPEN";
  const commissionRate = commissionRateFor(type, COMMISSION_RATES);

  if (type === "RIDE" || type === "COURIER") {
    if (!distanceKm) return res.status(400).json({ error: "distanceKm is required" });
    suggestedFare = rideFareThebe(distanceKm);
  } else if (type === "MOVING" && !custom) {
    if (!destination || capacityTier == null) return res.status(400).json({ error: "destination and capacityTier are required" });
    suggestedFare = truckFareThebe(destination, Number(capacityTier));
    if (suggestedFare == null) return res.status(400).json({ error: "Unknown destination" });
  } else if (type === "WASTE" || (type === "MOVING" && custom)) {
    status = "BIDDING"; // no fixed price — goes straight to open bidding
  }

  let price = suggestedFare;
  if (suggestedFare != null && offerPriceThebe != null) {
    if (offerPriceThebe < suggestedFare) return res.status(400).json({ error: `Offer cannot be below the suggested fare of ${suggestedFare / 100} BWP` });
    price = offerPriceThebe;
  }

  const job = await prisma.job.create({
    data: {
      type, subtype: subtype || null, rideTier: type === "RIDE" ? (rideTier || "go") : null,
      pickup, dropoff, itemDesc: itemDesc || null,
      description: description || null, distanceKm: distanceKm || null,
      pickupLat: pickupLat ?? null, pickupLng: pickupLng ?? null,
      stops: stops ? JSON.stringify(stops) : null,
      suggestedFare, price, status, custom: !!custom,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      commissionRate, customerId: req.userId,
    },
  });

  emit(req, "job:created", job);
  res.status(201).json(job);
});

// GET /jobs/mine  (as customer)
router.get("/mine", async (req, res) => {
  const jobs = await prisma.job.findMany({
    where: { customerId: req.userId },
    include: { bids: { include: { driver: { select: { id: true, name: true } } } }, driver: true, ratings: true },
    orderBy: { createdAt: "desc" },
  });

  // Same idea as the driver's job board: a customer choosing between bids
  // needs to see each driver's rating and completed-job count, not just
  // their price — otherwise "choose the best driver" isn't actually possible.
  const driverIds = jobs.flatMap((j) => [...(j.bids || []).map((b) => b.driverId), j.driverId]);
  const statsMap = await getUserStatsMap(driverIds, "driver");

  const enriched = jobs.map((j) => ({
    ...j,
    bids: (j.bids || []).map((b) => ({ ...b, driver: b.driver ? { ...b.driver, ...statsMap[b.driverId] } : null })),
    driver: j.driver ? { ...j.driver, ...statsMap[j.driverId] } : null,
  }));

  res.json(enriched);
});

// GET /jobs/board  (as driver — matched + optionally distance-sorted/enroute-filtered)
router.get("/board", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { vehicle: true } });
  if (!user.vehicle) return res.status(400).json({ error: "Register a vehicle before browsing the job board" });
  const v = user.vehicle;

  const orTypeFilters = [];
  if (v.type === "CAR") {
    if (v.serviceRide) orTypeFilters.push({ type: "RIDE" });
    if (v.serviceCourier) orTypeFilters.push({ type: "COURIER" });
  } else if (v.type === "TRUCK") {
    if (v.serviceGoods) orTypeFilters.push({ type: "MOVING", subtype: "goods" });
    if (v.serviceRemoval) orTypeFilters.push({ type: "MOVING", subtype: "removal" });
    orTypeFilters.push({ type: "MOVING", custom: true }); // trucks can also bid on custom/JCB-tagged jobs
  } else if (v.type === "WASTE") {
    if (v.wasteGeneral) orTypeFilters.push({ type: "WASTE", subtype: "general" });
    if (v.wasteClinical) orTypeFilters.push({ type: "WASTE", subtype: "clinical" });
  } else if (v.type === "EQUIPMENT") {
    orTypeFilters.push({ type: "MOVING", custom: true });
  }
  if (orTypeFilters.length === 0) return res.json([]);

  let jobs = await prisma.job.findMany({
    where: { driverId: null, status: { in: ["OPEN", "BIDDING"] }, OR: orTypeFilters },
    include: { bids: true, customer: true },
    orderBy: { createdAt: "desc" },
  });

  if (user.enrouteActive && user.enrouteDestination) {
    const dest = user.enrouteDestination.toLowerCase();
    jobs = jobs.filter((j) => j.dropoff.toLowerCase().includes(dest) || j.pickup.toLowerCase().includes(dest));
  }

  const withDistance = jobs.map((j) => ({
    ...j,
    distanceToPickupKm: haversineKm(user.lastLat, user.lastLng, j.pickupLat, j.pickupLng),
  }));
  withDistance.sort((a, b) => {
    if (a.distanceToPickupKm == null) return 1;
    if (b.distanceToPickupKm == null) return -1;
    return a.distanceToPickupKm - b.distanceToPickupKm;
  });

  // Attach the customer's rating + completed-job count to each card, so a
  // driver can weigh a job the same way a customer weighs a bid — not just
  // on price and distance, but on who they'd actually be dealing with.
  const statsMap = await getUserStatsMap(withDistance.map((j) => j.customerId), "customer");
  const enriched = withDistance.map((j) => ({
    ...j,
    customer: j.customer ? { id: j.customer.id, name: j.customer.name, ...statsMap[j.customerId] } : null,
  }));

  res.json(enriched);
});

// GET /jobs/active  (as driver — jobs currently assigned to me, not yet completed)
router.get("/active", async (req, res) => {
  const jobs = await prisma.job.findMany({
    where: { driverId: req.userId, status: { in: ["ACCEPTED"] } },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(jobs);
});

// PATCH /jobs/:id/accept  (driver instantly accepts at the listed price)
router.patch("/:id/accept", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.price == null) return res.status(400).json({ error: "This job has no fixed price — submit a bid instead" });

  // Atomic: the WHERE clause (driverId: null) is checked by the database in
  // the same statement as the write, so if two drivers tap Accept within
  // milliseconds of each other, only one UPDATE can match and succeed — the
  // second gets count: 0 and a clean "already taken" response, instead of
  // silently overwriting the first driver's assignment (a real race that
  // only shows up under concurrent load, which is exactly why this needs
  // stress testing, not just manual single-user testing).
  const result = await prisma.job.updateMany({
    where: { id: job.id, driverId: null },
    data: { driverId: req.userId, status: "ACCEPTED" },
  });
  if (result.count === 0) return res.status(409).json({ error: "Job already taken" });

  const updated = await prisma.job.findUnique({ where: { id: job.id } });
  const customer = await prisma.user.findUnique({ where: { id: job.customerId } });
  await notifyUser(customer, "Driver assigned", `A driver accepted your ${job.type.toLowerCase()} booking.`);
  emit(req, "job:updated", updated);
  res.json(updated);
});

// POST /jobs/:id/bids  (driver submits their own offer)
router.post("/:id/bids", async (req, res) => {
  const { amountThebe } = req.body;
  if (!amountThebe || amountThebe <= 0) return res.status(400).json({ error: "amountThebe must be a positive number" });

  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.driverId) return res.status(409).json({ error: "Job already taken" });

  const bid = await prisma.bid.create({ data: { jobId: job.id, driverId: req.userId, amount: amountThebe } });

  const customer = await prisma.user.findUnique({ where: { id: job.customerId } });
  const driver = await prisma.user.findUnique({ where: { id: req.userId } });
  await notifyUser(customer, "New offer received", `${driver.name} quoted P${(amountThebe / 100).toFixed(0)} on your booking.`);
  emit(req, "bid:created", { jobId: job.id, bid });
  res.status(201).json(bid);
});

// PATCH /jobs/:id/bids/:bidId/accept  (customer picks a driver's bid)
router.patch("/:id/bids/:bidId/accept", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.customerId !== req.userId) return res.status(403).json({ error: "Not your job" });
  const bid = await prisma.bid.findUnique({ where: { id: req.params.bidId } });
  if (!bid || bid.jobId !== job.id) return res.status(404).json({ error: "Bid not found" });

  // Same atomic guard as instant-accept — protects against the case where a
  // driver instant-accepted the job in the moment between the customer
  // loading the bid list and tapping "Accept" on one of them.
  const result = await prisma.job.updateMany({
    where: { id: job.id, driverId: null },
    data: { driverId: bid.driverId, price: bid.amount, status: "ACCEPTED" },
  });
  if (result.count === 0) return res.status(409).json({ error: "This job was already accepted by another driver" });

  const updated = await prisma.job.findUnique({ where: { id: job.id } });
  const driver = await prisma.user.findUnique({ where: { id: bid.driverId } });
  await notifyUser(driver, "Bid accepted", `Your quote was accepted for a ${job.type.toLowerCase()} job.`);
  emit(req, "job:updated", updated);
  res.json(updated);
});

// PATCH /jobs/:id/complete  (driver marks their accepted job done — credits their wallet)
router.patch("/:id/complete", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.driverId !== req.userId) return res.status(403).json({ error: "Not your job" });
  if (job.status !== "ACCEPTED") return res.status(400).json({ error: "Job is not in an accepted state" });

  const net = Math.round(job.price * (1 - job.commissionRate));

  const [updated] = await prisma.$transaction([
    prisma.job.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date() } }),
    prisma.user.update({ where: { id: req.userId }, data: { walletBalance: { increment: net } } }),
    prisma.walletTransaction.create({ data: { userId: req.userId, amount: net, kind: "job_earning", reference: job.id } }),
  ]);

  const customer = await prisma.user.findUnique({ where: { id: job.customerId } });
  await notifyUser(customer, "Job completed", `Your ${job.type.toLowerCase()} booking is complete.`);
  emit(req, "job:updated", updated);
  res.json(updated);
});

// PATCH /jobs/:id/cancel  (customer cancels while still unmatched)
router.patch("/:id/cancel", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.customerId !== req.userId) return res.status(403).json({ error: "Not your job" });
  if (job.driverId) return res.status(400).json({ error: "Can't cancel — a driver already accepted this job" });

  const updated = await prisma.job.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
  emit(req, "job:updated", updated);
  res.json(updated);
});

module.exports = router;
