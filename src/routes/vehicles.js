const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

const router = express.Router();
router.use(requireAuth);

// POST /vehicles  (multipart form: photo, clinicalPermit?) + body fields depending on type
// type: CAR | TRUCK | WASTE | EQUIPMENT
router.post("/", upload.fields([{ name: "photo", maxCount: 1 }, { name: "clinicalPermit", maxCount: 1 }]), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (user.role !== "DRIVER") return res.status(403).json({ error: "Only driver accounts register vehicles" });

  const { type, makeModel, color, plate, truckType, capacityTier, wasteGeneral, wasteClinical, equipmentDesc } = req.body;
  if (!["CAR", "TRUCK", "WASTE", "EQUIPMENT"].includes(type)) return res.status(400).json({ error: "Invalid vehicle type" });

  const files = req.files || {};
  const data = {
    type,
    photoUrl: files.photo ? `/uploads/${files.photo[0].filename}` : null,
  };

  if (type === "CAR") {
    if (!makeModel || !color || !plate) return res.status(400).json({ error: "makeModel, color, and plate are required for a car" });
    Object.assign(data, { makeModel, color, plate });
  } else if (type === "TRUCK") {
    if (!plate) return res.status(400).json({ error: "plate is required for a truck" });
    Object.assign(data, { truckType: truckType || "Other (specify)", capacityTier: Number(capacityTier) || 1, plate });
  } else if (type === "WASTE") {
    const general = wasteGeneral === "true" || wasteGeneral === true;
    const clinical = wasteClinical === "true" || wasteClinical === true;
    if (!general && !clinical) return res.status(400).json({ error: "Select at least one waste type" });
    Object.assign(data, {
      wasteGeneral: general,
      wasteClinical: clinical,
      plate: plate || null,
      clinicalPermitUrl: clinical && files.clinicalPermit ? `/uploads/${files.clinicalPermit[0].filename}` : null,
    });
  } else if (type === "EQUIPMENT") {
    Object.assign(data, { equipmentDesc: equipmentDesc || "Custom equipment" });
  }

  const vehicle = await prisma.vehicle.upsert({
    where: { userId: req.userId },
    update: data,
    create: { ...data, userId: req.userId },
  });
  res.json(vehicle);
});

// PATCH /vehicles/service-toggles  { serviceRide?, serviceCourier?, serviceGoods?, serviceRemoval? }
router.patch("/service-toggles", async (req, res) => {
  const allowed = ["serviceRide", "serviceCourier", "serviceGoods", "serviceRemoval"];
  const data = {};
  for (const k of allowed) if (k in req.body) data[k] = req.body[k];
  const vehicle = await prisma.vehicle.update({ where: { userId: req.userId }, data });
  res.json(vehicle);
});

module.exports = router;
