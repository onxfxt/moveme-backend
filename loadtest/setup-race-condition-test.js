// Creates N throwaway driver accounts, one customer, and ONE open ride job
// they'll all try to accept at the same time — then writes everything
// Artillery needs (tokens + the job id) to loadtest/data/race-condition.json.
//
// Run from backend/:  node loadtest/setup-race-condition-test.js [numDrivers]
//
// Safe to run against a dev/staging database. Do NOT run against production —
// it creates real rows. Uses your local Prisma client directly, so it must be
// run on the same machine/environment as the backend (same DATABASE_URL).

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const NUM_DRIVERS = Number(process.argv[2]) || 25;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "2h" });
}

async function main() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("replace-with")) {
    console.error("Set a real JWT_SECRET in backend/.env before running this — it must match the running server's secret.");
    process.exit(1);
  }

  console.log(`Creating ${NUM_DRIVERS} throwaway driver accounts + 1 customer + 1 contested job...`);

  const stamp = Date.now();
  const customer = await prisma.user.create({
    data: { name: "Loadtest Customer", phone: `+267loadtest-cust-${stamp}`, role: "CUSTOMER", verification: "VERIFIED" },
  });

  const drivers = [];
  for (let i = 0; i < NUM_DRIVERS; i++) {
    const driver = await prisma.user.create({
      data: { name: `Loadtest Driver ${i}`, phone: `+267loadtest-drv-${stamp}-${i}`, role: "DRIVER", verification: "VERIFIED" },
    });
    drivers.push({ id: driver.id, token: signToken(driver) });
  }

  // One ride job, priced, open, unclaimed — every driver token below will
  // race to PATCH /jobs/:id/accept on this exact job.
  const job = await prisma.job.create({
    data: {
      type: "RIDE",
      pickup: "Loadtest Pickup",
      dropoff: "Loadtest Dropoff",
      distanceKm: 8,
      suggestedFare: 3000, // P30.00 in thebe
      price: 3000,
      status: "OPEN",
      commissionRate: 0.11,
      customerId: customer.id,
    },
  });

  const outFile = path.join(__dirname, "data", "race-condition.json");
  fs.writeFileSync(outFile, JSON.stringify({ jobId: job.id, customerId: customer.id, drivers }, null, 2));

  console.log(`\nDone. Job ${job.id} is open for ${drivers.length} drivers to race over.`);
  console.log(`Wrote tokens to ${outFile}`);
  console.log(`\nNow run:  artillery run loadtest/race-condition.yml`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
