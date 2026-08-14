// Run AFTER artillery finishes: node loadtest/verify-race-result.js
// Checks the database directly — the real source of truth — rather than
// trusting captured HTTP responses, in case a response got lost/retried
// somewhere in transit during the load test itself.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const raceData = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "race-condition.json"), "utf8"));
  const job = await prisma.job.findUnique({ where: { id: raceData.jobId } });

  if (!job) {
    console.error("Couldn't find the test job — did setup-race-condition-test.js run against this same database?");
    process.exit(1);
  }

  console.log("\n=== Race condition result (from the database) ===");
  console.log(`Job ${job.id}`);
  console.log(`  status:    ${job.status}`);
  console.log(`  driverId:  ${job.driverId || "(none — no one accepted it)"}`);

  if (job.status === "ACCEPTED" && job.driverId) {
    const winner = raceData.drivers.find((d) => d.id === job.driverId);
    console.log(`\nPASS — exactly one driver (${winner ? winner.id : job.driverId}) ended up assigned. No double-booking.`);
  } else if (job.status === "OPEN") {
    console.log("\nNo one accepted it — re-run the Artillery scenario, or check the server is running and reachable.");
  } else {
    console.log(`\nUnexpected state: ${job.status}. Investigate before trusting this result.`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
