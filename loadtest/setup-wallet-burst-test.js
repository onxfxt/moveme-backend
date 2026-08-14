// Creates a pool of throwaway users for a wallet top-up burst test, plus one
// dedicated "hammered" account that many concurrent requests will all hit at
// once — the real point of this test isn't just "does the server survive",
// it's "does every single top-up actually land, with none lost to a race
// between concurrent balance updates".
//
// Run from backend/:  node loadtest/setup-wallet-burst-test.js [numUsers]

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const NUM_USERS = Number(process.argv[2]) || 50;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "2h" });
}

async function main() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("replace-with")) {
    console.error("Set a real JWT_SECRET in backend/.env before running this — it must match the running server's secret.");
    process.exit(1);
  }

  const stamp = Date.now();
  console.log(`Creating ${NUM_USERS} throwaway users + 1 dedicated "hammered" account...`);

  const hammered = await prisma.user.create({
    data: { name: "Loadtest Hammered Wallet", phone: `+267loadtest-hammered-${stamp}`, role: "DRIVER", verification: "VERIFIED" },
  });

  const users = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const u = await prisma.user.create({
      data: { name: `Loadtest Wallet User ${i}`, phone: `+267loadtest-wallet-${stamp}-${i}`, role: "DRIVER", verification: "VERIFIED" },
    });
    users.push({ id: u.id, token: signToken(u) });
  }

  const outFile = path.join(__dirname, "data", "wallet-burst.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify({ hammered: { id: hammered.id, token: signToken(hammered) }, users, topupAmountThebe: 1000 }, null, 2)
  );

  console.log(`\nDone. Wrote ${outFile}`);
  console.log(`Now run:  artillery run loadtest/wallet-burst.yml`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
