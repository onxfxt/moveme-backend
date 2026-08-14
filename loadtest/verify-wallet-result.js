// Run AFTER artillery finishes: node loadtest/verify-wallet-result.js
//
// The real question this answers: if 40 concurrent requests each add P10 to
// the SAME wallet, does the balance end up as exactly 40 x P10 — or did some
// of them get silently lost because two requests read the old balance before
// either had written the new one? Prisma's `increment` compiles to an atomic
// SQL "balance = balance + X", which should make this impossible — this
// script proves it actually held under real concurrent load rather than just
// trusting the code.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "wallet-burst.json"), "utf8"));

  const hammered = await prisma.user.findUnique({ where: { id: walletData.hammered.id } });
  const txns = await prisma.walletTransaction.findMany({ where: { userId: walletData.hammered.id, kind: "topup" } });
  const expectedBalance = txns.reduce((sum, t) => sum + t.amount, 0);

  console.log("\n=== Wallet burst result — the HAMMERED account (from the database) ===");
  console.log(`Top-up transactions recorded: ${txns.length}`);
  console.log(`Sum of those transactions:    P${(expectedBalance / 100).toFixed(2)}`);
  console.log(`Actual wallet balance:        P${(hammered.walletBalance / 100).toFixed(2)}`);

  if (hammered.walletBalance === expectedBalance) {
    console.log("\nPASS — every recorded top-up is reflected in the balance. No writes were lost under concurrent load.");
  } else {
    console.log("\nFAIL — the balance doesn't match the sum of its own transaction log. This means concurrent top-ups overwrote");
    console.log("each other instead of adding up — check that wallet.js uses `increment` (atomic) rather than reading the");
    console.log("balance, adding in application code, then writing it back (which is NOT atomic and loses updates under load).");
  }

  // A lighter sanity check across the wider pool of distributed accounts —
  // each should have exactly one transaction (barring the small chance the
  // random 20%/80% split in the processor skipped every hit for one of them).
  const poolIds = walletData.users.map((u) => u.id);
  const poolTxns = await prisma.walletTransaction.groupBy({ by: ["userId"], where: { userId: { in: poolIds }, kind: "topup" }, _count: true });
  console.log(`\nDistributed pool: ${poolTxns.length} of ${poolIds.length} accounts received at least one top-up.`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
