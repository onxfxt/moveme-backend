// One-time setup script: creates the first admin ("owner") account for the
// admin terminal. Run with: node prisma/seed-admin.js
//
// Owner accounts can create/disable other staff admin accounts from inside
// the terminal itself afterwards — you only need to run this script once.

require("dotenv").config();
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// Basic password prompt. Note: input is visible in the terminal (not masked)
// — this is a simplicity trade-off for a one-time local setup script, run in
// a terminal only you can see. Don't run this over someone's shoulder.
function askHidden(query) {
  return ask(query);
}

async function main() {
  console.log("\nmoveMe admin terminal — create the first (owner) admin account\n");
  const name = await ask("Your name: ");
  const email = (await ask("Email (used to log in): ")).trim().toLowerCase();
  const password = await askHidden("Password (min 8 characters): ");

  if (!name || !email || !password || password.length < 8) {
    console.error("\nAll fields are required and the password must be at least 8 characters. Try again.");
    process.exit(1);
  }

  let existing;
  try {
    existing = await prisma.adminAccount.findUnique({ where: { email } });
  } catch (e) {
    console.error("\nCouldn't reach the database. This is almost always one of:");
    console.error("  1. WAMP isn't running — its tray icon should be solid GREEN, not orange/red.");
    console.error('  2. The "moveme" database doesn\'t exist yet — open phpMyAdmin (click the WAMP');
    console.error('     tray icon > phpMyAdmin) and create a database named exactly "moveme".');
    console.error("  3. Migrations haven't run yet — from the backend/ folder, run:");
    console.error("       npx prisma migrate dev --name init");
    console.error("     first, then re-run this script.");
    console.error("  4. DATABASE_URL in your .env doesn't match WAMP's MySQL (default: mysql://root:@localhost:3306/moveme).");
    console.error(`\nRaw error: ${e.message}`);
    process.exit(1);
  }
  if (existing) {
    console.error(`\nAn admin account with ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.adminAccount.create({ data: { name, email, passwordHash, role: "owner" } });
  } catch (e) {
    console.error(`\nCouldn't create the account: ${e.message}`);
    process.exit(1);
  }

  console.log(`\nDone — ${email} can now log in at the admin terminal as an owner.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
